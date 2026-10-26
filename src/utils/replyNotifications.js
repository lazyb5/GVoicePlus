/**********************************************************************************************************************
 * Shows notifications forwarded by notificationShim.js as native Electron notifications with an inline reply
 * field, and sends replies by driving the Google Voice page.
 *
 * Safety rule: a reply is only sent if the conversation is identified (one candidate, or the notification's text picks
 * exactly one; see pickThread) and the open conversation pane is confirmed to show it, with the message box inside that
 * pane (see confirmPane), both just before sending.  If anything is ambiguous or doesn't line up, nothing is sent and a "Reply not sent" notification
 * asks the person to reply in the app and shows their text so it isn't lost.
 **********************************************************************************************************************/

const { ipcMain, Notification } = require('electron');
const ipcGuard = require('./ipcGuard');
const ts = () => new Date().toISOString().slice(11, 23);   // HH:MM:SS.mmm UTC, for the [reply] debug log

// Selectors, taken from Google Voice's current markup.  They are deliberately light on class names: custom element
// tags and a few structural hooks.  If a reply fails with a code like 'input-not-found', this is the place to fix.
const SEL = {
    thread:      'gv-thread-list-item',
    rowClick:    '.container',
    activeRow:   '.container.active',
    preview:     'gv-annotation.preview',
    pane:        'gv-thread-details',
    header:      'gv-thread-details-header',
    messagesNav: "gv-side-nav a.navListItem[aria-label^='Messages']",
    entry:       'gv-message-entry',
    input:       "gv-message-entry textarea, gv-message-entry [contenteditable='true']"
};

// Picks which row of the conversation list a notification belongs to.  It never touches the page, so it can be tested,
// and it is stringified and passed into the page together with pageReply.  `snaps` has one entry per list row:
// { titles: [text owned directly by each element in the row], preview: 'latest message', active: bool }, all
// normalised (lower case, direction marks removed).  Returns { index, kind, byText } or { error }.
//   kind 'title': a row whose title is exactly the sender (a contact or phone number)
//   kind 'group': a row whose preview starts "sender:" (a group chat whose latest message is from the sender)
//   - One candidate row: it is used (byText false).
//   - Several candidates (duplicate titles, several groups, a title plus a group): the notification's text must pick
//     exactly one by appearing in its preview (byText true).  If it picks none or more than one, the result is
//     'thread-ambiguous': nothing is sent and the person is told to reply in the app.  The first candidate is never
//     taken just because it is first.
// Limit: the rows read from the page may not be the whole list, so a lone visible row is not proof that no other
// conversation has the same name.  This code has no conversation ID to compare (the notification shim forwards only
// title, text and tag).  If an ID is ever confirmed on the live page it should replace this matching.
function pickThread(snaps, want, wantBody) {
    const isTitle = (s) => s.titles.includes(want);
    const isGroup = (s) => !isTitle(s) && s.preview.startsWith(want + ':');
    const cand = [];
    snaps.forEach((s, i) => { if (isTitle(s) || isGroup(s)) { cand.push(i); } });
    if (!cand.length) { return { error: 'thread-not-found' }; }
    const kindOf = (i) => (isTitle(snaps[i]) ? 'title' : 'group');
    if (cand.length === 1) { return { index: cand[0], kind: kindOf(cand[0]), byText: false }; }
    const hits = wantBody ? cand.filter((i) => snaps[i].preview.includes(wantBody)) : [];
    if (hits.length === 1) { return { index: hits[0], kind: kindOf(hits[0]), byText: true }; }
    return { error: 'thread-ambiguous' };
}

// Confirms the row that was chosen and clicked.  It does not choose again: it looks at that one row (by position of the
// same page element) and requires that it still shows the sender it was chosen for, that it is the only selected
// thread, and that the conversation pane is open.  Same stringify-into-the-page rules as pickThread.
function confirmThread(snaps, index, kind, want, headerOpen) {
    const s = snaps[index];
    if (!s || !headerOpen || !s.active) { return false; }
    if (snaps.filter((x) => x.active).length !== 1) { return false; }
    return kind === 'title' ? s.titles.includes(want) : s.preview.startsWith(want + ':');
}

// Confirms the OPEN conversation pane, which is what the reply is typed into (a selected list row alone proves nothing
// about it).  `info` is read from the page: { pane: the pane exists, composer: the message box was found INSIDE that
// pane, header: the pane header's text, text: the pane's text }, all normalised.  The pane must show the sender (title
// rows: in the header; group rows: anywhere in the pane).  When the notification's text was what chose the
// conversation (needText), the pane must contain it too.  Returns '' when it lines up, otherwise the reason:
//   'pane-mismatch'     no pane or header, or the pane does not show what it must
//   'composer-mismatch' the message box that would be typed into is not inside the open pane
// Same stringify-into-the-page rules as pickThread.
function confirmPane(info, kind, want, wantBody, needText) {
    if (!info.pane || !info.header) { return 'pane-mismatch'; }
    if (!info.composer) { return 'composer-mismatch'; }
    if (kind === 'title' ? !info.header.includes(want) : !info.text.includes(want)) { return 'pane-mismatch'; }
    if (needText && (!wantBody || !info.text.includes(wantBody))) { return 'pane-mismatch'; }
    return '';
}

// Runs INSIDE the Google Voice page (it is stringified and executed there), so it must be self-contained.
// `name` is the notification's title and `body` its text.  pickThread chooses the conversation (or refuses with
// 'thread-ambiguous' / 'thread-not-found'); the chosen row is clicked and confirmThread is checked on that same row;
// confirmPane then checks the OPEN pane (it must show the sender, and the notification's text when the text was what
// chose the conversation, and contain the message box that is typed into).  Both are checked again just before
// sending.  Any failure sends nothing.
// A draft in any message box is never overwritten: it blocks a thread switch, and is put back afterwards.
// With dryRun=true it does everything except click send.
async function pageReply(name, text, SEL, dryRun, body, pickThread, confirmThread, confirmPane) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Google wraps phone numbers in invisible direction marks; strip those so "33201" matches "\u202a33201\u202c".
    const norm = (s) => (s || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(name);
    const wantBody = norm(body).slice(0, 30);

    // Text that belongs directly to each element in a subtree (not its children's text).
    const ownTexts = (root) => Array.from(root.querySelectorAll('*')).map((e) =>
        norm(Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' '))).filter(Boolean);
    const previewOf = (row) => { const p = row.querySelector(SEL.preview); return norm(p ? p.textContent : ''); };
    const snapshot = (r) => ({ titles: ownTexts(r), preview: previewOf(r), active: !!r.querySelector(SEL.activeRow) });
    const listRows = () => Array.from(document.querySelectorAll(SEL.thread));
    const resolve = () => { const rows = listRows(); return { rows, pick: pickThread(rows.map(snapshot), want, wantBody) }; };
    const toChosen = (x) => ({ row: x.rows[x.pick.index], kind: x.pick.kind, byText: x.pick.byText });
    // Is `row` (the very element that was chosen, not a fresh selection) still in the list, still showing the sender it
    // was chosen for, the only selected thread, with the conversation pane open?
    const isOpen = (row, kind) => {
        const rows = listRows();
        return confirmThread(rows.map(snapshot), rows.indexOf(row), kind, want, !!document.querySelector(SEL.header));
    };
    const waitFor = async (fn, tries, ms) => { for (let i = 0; i < tries; i++) { const v = fn(); if (v) { return v; } await sleep(ms); } return fn(); };

    // The message box and send button are only ever taken from INSIDE the open conversation pane.
    const paneEl = () => document.querySelector(SEL.pane);
    const composerEl = () => { const p = paneEl(); return p ? p.querySelector(SEL.input) : null; };
    const entryEl = () => { const p = paneEl(); return p ? p.querySelector(SEL.entry) : null; };
    const paneInfo = () => {
        const p = paneEl();
        const h = p ? p.querySelector(SEL.header) : null;
        return { pane: !!p, composer: !!composerEl(), header: h ? norm(h.textContent) : '', text: p ? norm(p.textContent) : '' };
    };

    // Google Voice's website drops unsent text when you change threads, so never leave a thread that has some typed in
    // it.  Every message box on the page is checked, so a draft is protected wherever it sits.
    const hasText = (b) => !!((b.isContentEditable ? b.innerText : b.value) || '').trim();
    const openDraft = () => Array.from(document.querySelectorAll(SEL.input)).some(hasText);

    let r = resolve();
    if (r.pick.error === 'thread-ambiguous') { return 'thread-ambiguous'; }
    let chosen = r.pick.error ? null : toChosen(r);
    if (!chosen || !isOpen(chosen.row, chosen.kind)) {
        if (openDraft()) { return 'draft-present'; }
        if (!chosen) {
            // Thread not in the list being shown: that is usually because another tab is open (Calls, Voicemail, Spam...),
            // and those tabs have rows too, so "no rows at all" is not a good test.  Go to Messages unless already there.
            if (!/\/messages(\/|$)/.test(location.pathname)) {
                const nav = document.querySelector(SEL.messagesNav);
                if (nav) {
                    nav.click();
                    r = (await waitFor(() => { const x = resolve(); return x.pick.error === 'thread-not-found' ? null : x; }, 20, 150)) || resolve();
                }
            }
            if (r.pick.error) { return r.pick.error; }
            chosen = toChosen(r);
        }
        if (openDraft()) { return 'draft-present'; }   // typed while we waited for the list
        (chosen.row.querySelector(SEL.rowClick) || chosen.row).click();
        if (!(await waitFor(() => isOpen(chosen.row, chosen.kind), 25, 120))) { return 'thread-mismatch'; }
    }

    // The selected row is not enough: the open pane must itself show this conversation, and hold the message box.  The
    // pane can take a moment to load after a click.
    const paneProblem = () => confirmPane(paneInfo(), chosen.kind, want, wantBody, chosen.byText);
    if (paneProblem()) { await waitFor(() => !paneProblem(), 20, 120); }
    const problem = paneProblem();
    if (problem) { return problem; }

    let box = await waitFor(composerEl, 15, 120);
    if (!box) { return 'input-not-found'; }
    const getText = () => (box.isContentEditable ? box.innerText : box.value) || '';
    const setText = (value) => {
        box.focus();
        if (box.isContentEditable) {
            document.execCommand('selectAll', false, null);
            if (value) { document.execCommand('insertText', false, value); } else { document.execCommand('delete', false, null); }
        } else {
            const proto = box.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(box, value);
            box.dispatchEvent(new Event('input', { bubbles: true }));
        }
    };
    const draft = getText();            // whatever the user had typed here; restored below
    const restoreDraft = () => { if (draft) { setText(draft); } else { setText(''); } };
    setText(text);
    await sleep(250);

    const entry = entryEl();
    const buttons = entry ? Array.from(entry.querySelectorAll('button')) : [];
    const label = (b) => norm([b.getAttribute('aria-label'), b.getAttribute('gv-test-id'), b.getAttribute('mattooltip'), b.title].join(' '));
    const send = buttons.find((b) => /send/.test(label(b)))
        || buttons.filter((b) => !/attach|image|photo|upload|media/.test(label(b))).pop();
    if (!send) { restoreDraft(); return 'send-not-found'; }
    if (send.disabled) { await sleep(500); }
    if (send.disabled) { restoreDraft(); return 'send-disabled'; }
    // The page can change while the text is being typed: the same conversation must still be open right now.
    if (!isOpen(chosen.row, chosen.kind)) { restoreDraft(); return 'thread-mismatch'; }
    const late = paneProblem();
    if (late) { restoreDraft(); return late; }
    if (dryRun) { restoreDraft(); return 'ok-dryrun (send button: ' + (label(send) || send.tagName.toLowerCase()) + ')'; }
    send.click();
    // Google empties the message box once it accepts the message, so wait for that instead of assuming the click
    // worked.  The box element can be re-created, so look it up again each time (any message box still holding our text
    // counts).  If our text is still there after about 3 s the send is "unconfirmed": the box is left alone (the text
    // is not lost), nothing is retried (a slow send must not go out twice) and the caller tells the user to check the
    // thread.
    const sentText = norm(text);
    const stillInBox = () => Array.from(document.querySelectorAll(SEL.input))
        .some((b) => norm(b.isContentEditable ? b.innerText : b.value).includes(sentText));
    if (!(await waitFor(() => !stillInBox(), 25, 120))) { return 'send-unconfirmed'; }
    box = composerEl() || box;
    if (draft) { await sleep(200); restoreDraft(); }
    return 'ok';
}

// Runs INSIDE the Google Voice page.  Opens the conversation a message came from, which is the only way Google Voice's
// website marks it read (there is no "mark as read" control).  Used after a verification code was copied while the
// window is in the background.  It never types into the page.  Nothing is opened when:
//   - the conversation is already open (Google marks it read by itself),
//   - the open conversation has something typed in its message box (opening another thread must never risk a draft),
//   - the Messages list isn't showing, or no thread matches the sender exactly (same matching rules as pageReply).
// OUTSTANDING (separate from the reply fix): the row matching below is still the OLD logic.  When several rows match it
// takes the first one, and it does not check the open pane.  It only opens a conversation (it never types), so the harm
// is marking the wrong conversation read.  Left unchanged on purpose; it should move to pickThread/confirmPane later.
async function pageMarkRead(name, body, SEL) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) => (s || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(name);
    const wantBody = norm(body).slice(0, 30);
    const ownTexts = (root) => Array.from(root.querySelectorAll('*')).map((e) =>
        norm(Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' '))).filter(Boolean);
    const previewOf = (row) => { const p = row.querySelector(SEL.preview); return norm(p ? p.textContent : ''); };
    const targetRow = () => {
        const rows = Array.from(document.querySelectorAll(SEL.thread));
        const byTitle = rows.filter((r) => ownTexts(r).includes(want));
        const pool = byTitle.length ? byTitle : rows.filter((r) => previewOf(r).startsWith(want + ':'));
        if (!pool.length) { return null; }
        return (wantBody && pool.find((r) => previewOf(r).includes(wantBody))) || pool[0];
    };
    const targetActive = () => { const r = targetRow(); return !!r && !!r.querySelector(SEL.activeRow) && !!document.querySelector(SEL.header); };
    const waitFor = async (fn, tries, ms) => { for (let i = 0; i < tries; i++) { const v = fn(); if (v) { return v; } await sleep(ms); } return fn(); };
    const draftOpen = () => {
        const box = document.querySelector(SEL.input);
        return !!box && !!((box.isContentEditable ? box.innerText : box.value) || '').trim();
    };

    if (draftOpen()) { return 'draft-present'; }
    if (targetActive()) { return 'already-open'; }
    if (!/\/messages(\/|$)/.test(location.pathname)) { return 'not-on-messages'; }
    const row = await waitFor(targetRow, 20, 150);   // the new message can take a moment to appear in the list
    if (!row) { return 'thread-not-found'; }
    if (draftOpen()) { return 'draft-present'; }
    (row.querySelector(SEL.rowClick) || row).click();
    return (await waitFor(targetActive, 25, 120)) ? 'ok' : 'thread-mismatch';
}

// The script run inside the page for one reply: pageReply plus the three pure functions it is given.
const replyScript = (title, text, body, dryRun = false) =>
    `(${pageReply.toString()})(${JSON.stringify(title)}, ${JSON.stringify(text)}, ${JSON.stringify(SEL)}, ${dryRun ? 'true' : 'false'}, ` +
    `${JSON.stringify(body || '')}, ${pickThread.toString()}, ${confirmThread.toString()}, ${confirmPane.toString()})`;

// Results that mean "could not tell which conversation": shown to the person in plain words.
const THREAD_CODES = ['thread-ambiguous', 'thread-not-found', 'thread-mismatch', 'pane-mismatch', 'composer-mismatch'];

module.exports.SEL = SEL;
module.exports.pickThread = pickThread;
module.exports.confirmThread = confirmThread;
module.exports.confirmPane = confirmPane;
module.exports.replyScript = replyScript;     // exported so the reply path can be tested without sending
module.exports.pageReplySource = pageReply.toString();
module.exports.pageMarkReadSource = pageMarkRead.toString();

// Google's send step (reCAPTCHA, then the request) does not run until the page is focused: with the window hidden,
// minimized or in the background the click is accepted but the message sits until the user brings the window
// forward.  Chromium's focus emulation makes the page believe it is focused for the length of one reply and is
// switched off again afterwards; any failure here is ignored (the reply is still attempted).
async function withPageFocus(win, fn) {
    const dbg = win.webContents.debugger;
    let attachedHere = false;
    let emulating = false;
    try {
        if (!dbg.isAttached()) { dbg.attach('1.3'); attachedHere = true; }
        await dbg.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
        emulating = true;
    } catch (e) {
        console.log(`${ts()} [reply] focus emulation unavailable: ${e && e.message}`);
    }
    try {
        return await fn();
    } finally {
        try { if (emulating) { await dbg.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }); } } catch (e) { /* ignore */ }
        try { if (attachedHere && dbg.isAttached()) { dbg.detach(); } } catch (e) { /* ignore */ }
    }
}

// isTrustedSender(event) says whether an IPC message really came from the Google Voice page (main.js).  Without it nothing
// is accepted.  Messages are also checked for shape and size, and a page cannot raise more than a handful of
// notifications per second.
module.exports.init = function ({ getWindow, onMessage, isTrustedSender = () => false }) {
    const allowNotification = ipcGuard.createRateLimiter(30, 10000);
    let replyQueue = Promise.resolve();   // replies run one at a time: two scripts must not drive the message box together
    const shown = new Map();   // id -> Notification (holding a reference keeps its handlers alive)
    const byTag = new Map();   // tag -> id, so a newer notification replaces an older one

    // After a verification code was copied, open that conversation so Google marks it read, but only while the window is
    // hidden, minimized or not the active window, so the view you are working in is never changed under you.
    function markReadInBackground(title, body) {
        replyQueue = replyQueue.then(async () => {
            const win = getWindow();
            if (!win || win.isDestroyed()) { return; }
            if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
                console.log(`${ts()} [markread] skipped (window is active)`);
                return;
            }
            let result = 'error';
            try {
                const run = () => win.webContents.executeJavaScript(
                    `(${pageMarkRead.toString()})(${JSON.stringify(title)}, ${JSON.stringify(body || '')}, ${JSON.stringify(SEL)})`
                );
                result = await withPageFocus(win, run);   // the page only treats a thread as read while it believes it is focused
            } catch (e) { /* result stays 'error' */ }
            console.log(`${ts()} [markread] result=${result}`);
        }).catch((e) => console.log(`${ts()} [markread] unexpected error: ${e && e.message}`));
    }

    ipcMain.on('gv-notify', (event, data) => {
        if (!isTrustedSender(event)) { console.log(`${ts()} [notify] ignored: sender not accepted`); return; }
        const clean = ipcGuard.cleanNotification(data);
        if (!clean || !allowNotification()) { console.log(`${ts()} [notify] ignored: malformed or too many`); return; }
        const { id, title, body, tag, silent } = clean;
        if (tag && byTag.has(tag)) {
            const old = shown.get(byTag.get(tag));
            if (old) { old.close(); }
        }
        // onMessage (verification-code copy) runs first so the banner can say when a code was copied.  It must never
        // be able to stop a notification from showing.
        let copiedCode = null;
        try { copiedCode = onMessage ? onMessage(body) : null; } catch (e) { /* ignore */ }
        const n = new Notification({
            title, body, silent, hasReply: true, replyPlaceholder: 'Reply…',
            ...(copiedCode ? { subtitle: 'Code copied (clears in 1 min)' } : {})
        });
        shown.set(id, n);
        if (tag) { byTag.set(tag, id); }

        n.on('click', () => {
            if (!event.sender.isDestroyed()) { event.sender.send('gv-notify-click', id); }
        });

        let lastReply = { text: '', at: 0 };
        n.on('reply', (_e, replyText) => {
            const text = (replyText || '').trim();
            if (!text) { return; }
            // Windows can report the same reply twice; never send the same text twice from one notification within a few seconds.
            if (text === lastReply.text && Date.now() - lastReply.at < 5000) { console.log(`${ts()} [reply] duplicate event ignored`); return; }
            lastReply = { text, at: Date.now() };
            const queuedAt = Date.now();
            const w = getWindow();
            console.log(`${ts()} [reply] event received (${text.length} chars) visible=${!!w && w.isVisible()} minimized=${!!w && w.isMinimized()} focused=${!!w && w.isFocused()}`);
            replyQueue = replyQueue.then(async () => {
                const t0 = Date.now();
                const win = getWindow();
                let result = 'no-window';
                if (win && !win.isDestroyed()) {
                    try {
                        const run = () => win.webContents.executeJavaScript(replyScript(title, text, body));
                        result = win.isFocused() ? await run() : await withPageFocus(win, run);
                    } catch (e) {
                        result = 'error';
                    }
                }
                console.log(`${ts()} [reply] result=${result} after ${Date.now() - t0} ms (queued ${t0 - queuedAt} ms)`);
                if (result !== 'ok') {
                    // 'draft-present' is the log code; the person sees plain words.
                    const heading = result === 'send-unconfirmed'
                        ? `Reply to ${title} not confirmed - check the thread`
                        : result === 'draft-present'
                            ? `Reply to ${title} not sent - you have unsent text in another conversation`
                            : THREAD_CODES.includes(result)
                                ? `Reply to ${title} not sent - couldn't tell which conversation, open the app to reply`
                                : `Reply to ${title} not sent (${result})`;
                    new Notification({ title: heading, body: text }).show();
                }
            }).catch((e) => console.log(`${ts()} [reply] unexpected error: ${e && e.message}`));
        });

        n.on('close', () => { shown.delete(id); });
        n.show();
        console.log(`${ts()} [notify] shown id=${id}`);
        // Only for 6+ digit codes: short codes are the likeliest false matches, and marking a real message read is worse
        // than a stray number on the clipboard.
        if (copiedCode && copiedCode.length >= 6) { markReadInBackground(title, body); }
    });

    ipcMain.on('gv-notify-close', (event, id) => {
        if (!isTrustedSender(event) || !ipcGuard.isInt(id, 0, 2147483647)) { return; }
        const n = shown.get(id);
        if (n) { n.close(); }
        shown.delete(id);
    });
};

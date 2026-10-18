/**********************************************************************************************************************
 * Shows notifications forwarded by notificationShim.js as native Electron notifications with an inline reply
 * field, and sends replies by driving the Google Voice page.
 *
 * Safety rule: a reply is only sent if the open conversation's title EXACTLY matches the notification's sender.
 * If anything doesn't line up, nothing is sent and a "Reply not sent" notification shows your text so it isn't lost.
 **********************************************************************************************************************/

const { ipcMain, Notification } = require('electron');
const ts = () => new Date().toISOString().slice(11, 23);   // HH:MM:SS.mmm UTC, for the [reply] debug log

// Selectors, taken from Google Voice's current markup.  They are deliberately light on class names: custom element
// tags and a few structural hooks.  If a reply fails with a code like 'input-not-found', this is the place to fix.
const SEL = {
    thread:      'gv-thread-list-item',
    rowClick:    '.container',
    activeRow:   '.container.active',
    preview:     'gv-annotation.preview',
    header:      'gv-thread-details-header',
    messagesNav: "gv-side-nav a.navListItem[aria-label^='Messages']",
    entry:       'gv-message-entry',
    input:       "gv-message-entry textarea, gv-message-entry [contenteditable='true']"
};

// Runs INSIDE the Google Voice page (it is stringified and executed there), so it must be self-contained.
// `name` is the notification's title and `body` its text.  The thread is chosen like this:
//   1. a thread whose title is exactly `name` (a contact or phone number), else
//   2. a group thread whose latest message is from `name` (the list shows "name: message"), preferring the one whose
//      preview matches the notification's text.
// Nothing looser than that is accepted, and the reply only goes out once that row is the selected thread.
// A draft already in the message box is put back afterwards.
// With dryRun=true it does everything except click send.
async function pageReply(name, text, SEL, dryRun, body) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Google wraps phone numbers in invisible direction marks; strip those so "33201" matches "\u202a33201\u202c".
    const norm = (s) => (s || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(name);
    const wantBody = norm(body).slice(0, 30);

    // Text that belongs directly to each element in a subtree (not its children's text).
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

    // Google Voice's website drops unsent text when you change threads, so never leave a thread that has some typed in it.
    const openDraft = () => {
        const b = document.querySelector(SEL.input);
        return !!b && !!((b.isContentEditable ? b.innerText : b.value) || '').trim();
    };

    if (!targetActive()) {
        if (openDraft()) { return 'draft-present'; }
        let row = targetRow();
        // Thread not in the list being shown: that is usually because another tab is open (Calls, Voicemail, Spam...),
        // and those tabs have rows too, so "no rows at all" is not a good test.  Go to Messages unless already there.
        if (!row && !/\/messages(\/|$)/.test(location.pathname)) {
            const nav = document.querySelector(SEL.messagesNav);
            if (nav) { nav.click(); row = await waitFor(targetRow, 20, 150); }
        }
        if (!row) { return 'thread-not-found'; }
        if (openDraft()) { return 'draft-present'; }   // typed while we waited for the list
        (row.querySelector(SEL.rowClick) || row).click();
        if (!(await waitFor(targetActive, 25, 120))) { return 'thread-mismatch'; }
    }

    let box = await waitFor(() => document.querySelector(SEL.input), 15, 120);
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

    const entry = document.querySelector(SEL.entry);
    const buttons = entry ? Array.from(entry.querySelectorAll('button')) : [];
    const label = (b) => norm([b.getAttribute('aria-label'), b.getAttribute('gv-test-id'), b.getAttribute('mattooltip'), b.title].join(' '));
    const send = buttons.find((b) => /send/.test(label(b)))
        || buttons.filter((b) => !/attach|image|photo|upload|media/.test(label(b))).pop();
    if (!send) { restoreDraft(); return 'send-not-found'; }
    if (send.disabled) { await sleep(500); }
    if (send.disabled) { restoreDraft(); return 'send-disabled'; }
    if (dryRun) { restoreDraft(); return 'ok-dryrun (send button: ' + (label(send) || send.tagName.toLowerCase()) + ')'; }
    send.click();
    // Google empties the message box once it accepts the message, so wait for that instead of assuming the click
    // worked.  The box element can be re-created, so look it up again each time.  If our text is still there after
    // about 3 s the send is "unconfirmed": the box is left alone (the text is not lost), nothing is retried (a slow
    // send must not go out twice) and the caller tells the user to check the thread.
    const sentText = norm(text);
    const stillInBox = () => {
        const b = document.querySelector(SEL.input);
        return !!b && norm(b.isContentEditable ? b.innerText : b.value).includes(sentText);
    };
    if (!(await waitFor(() => !stillInBox(), 25, 120))) { return 'send-unconfirmed'; }
    box = document.querySelector(SEL.input) || box;
    if (draft) { await sleep(200); restoreDraft(); }
    return 'ok';
}

// Runs INSIDE the Google Voice page.  Opens the conversation a message came from, which is the only way Google Voice's
// website marks it read (there is no "mark as read" control).  Used after a verification code was copied while the
// window is in the background.  It never types into the page.  Nothing is opened when:
//   - the conversation is already open (Google marks it read by itself),
//   - the open conversation has something typed in its message box (opening another thread must never risk a draft),
//   - the Messages list isn't showing, or no thread matches the sender exactly (same matching rules as pageReply).
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

module.exports.SEL = SEL;
module.exports.pageReplySource = pageReply.toString();   // exported so the reply path can be tested without sending
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

module.exports.init = function ({ getWindow, onMessage }) {
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

    ipcMain.on('gv-notify', (event, { id, title, body, tag, silent }) => {
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

        n.on('reply', (_e, replyText) => {
            const text = (replyText || '').trim();
            if (!text) { return; }
            const queuedAt = Date.now();
            const w = getWindow();
            console.log(`${ts()} [reply] event received (${text.length} chars) visible=${!!w && w.isVisible()} minimized=${!!w && w.isMinimized()} focused=${!!w && w.isFocused()}`);
            replyQueue = replyQueue.then(async () => {
                const t0 = Date.now();
                const win = getWindow();
                let result = 'no-window';
                if (win && !win.isDestroyed()) {
                    try {
                        const run = () => win.webContents.executeJavaScript(
                            `(${pageReply.toString()})(${JSON.stringify(title)}, ${JSON.stringify(text)}, ${JSON.stringify(SEL)}, false, ${JSON.stringify(body || '')})`
                        );
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

    ipcMain.on('gv-notify-close', (_e, id) => {
        const n = shown.get(id);
        if (n) { n.close(); }
        shown.delete(id);
    });
};

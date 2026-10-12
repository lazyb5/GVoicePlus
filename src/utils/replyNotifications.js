/**********************************************************************************************************************
 * Shows notifications forwarded by notificationShim.js as native Electron notifications with an inline reply
 * field, and sends replies by driving the Google Voice page.
 *
 * Safety rule: a reply is only sent if the open conversation's title EXACTLY matches the notification's sender.
 * If anything doesn't line up, nothing is sent and a "Reply not sent" notification shows your text so it isn't lost.
 **********************************************************************************************************************/

const { ipcMain, Notification } = require('electron');

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

    if (!targetActive()) {
        let row = targetRow();
        if (!row && !document.querySelector(SEL.thread)) {   // not on the Messages tab: go there first
            const nav = document.querySelector(SEL.messagesNav);
            if (nav) { nav.click(); row = await waitFor(targetRow, 12, 150); }
        }
        if (!row) { return 'thread-not-found'; }
        (row.querySelector(SEL.rowClick) || row).click();
        if (!(await waitFor(targetActive, 25, 120))) { return 'thread-mismatch'; }
    }

    const box = await waitFor(() => document.querySelector(SEL.input), 15, 120);
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
    if (draft) { await sleep(500); restoreDraft(); }
    return 'ok';
}

module.exports.SEL = SEL;
module.exports.pageReplySource = pageReply.toString();   // exported so the reply path can be tested without sending

module.exports.init = function ({ getWindow }) {
    const shown = new Map();   // id -> Notification (holding a reference keeps its handlers alive)
    const byTag = new Map();   // tag -> id, so a newer notification replaces an older one

    ipcMain.on('gv-notify', (event, { id, title, body, tag, silent }) => {
        if (tag && byTag.has(tag)) {
            const old = shown.get(byTag.get(tag));
            if (old) { old.close(); }
        }
        const n = new Notification({ title, body, silent, hasReply: true, replyPlaceholder: 'Reply…' });
        shown.set(id, n);
        if (tag) { byTag.set(tag, id); }

        n.on('click', () => {
            if (!event.sender.isDestroyed()) { event.sender.send('gv-notify-click', id); }
        });

        n.on('reply', async (_e, replyText) => {
            const text = (replyText || '').trim();
            if (!text) { return; }
            const win = getWindow();
            let result = 'no-window';
            if (win && !win.isDestroyed()) {
                try {
                    result = await win.webContents.executeJavaScript(
                        `(${pageReply.toString()})(${JSON.stringify(title)}, ${JSON.stringify(text)}, ${JSON.stringify(SEL)}, false, ${JSON.stringify(body || '')})`
                    );
                } catch (e) {
                    result = 'error';
                }
            }
            if (result !== 'ok') {
                new Notification({ title: `Reply to ${title} not sent (${result})`, body: text }).show();
            }
        });

        n.on('close', () => { shown.delete(id); });
        n.show();
    });

    ipcMain.on('gv-notify-close', (_e, id) => {
        const n = shown.get(id);
        if (n) { n.close(); }
        shown.delete(id);
    });
};

const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const Module = require('module');

// replyNotifications.js loads electron at the top; give it a stub so these tests run without the Electron binary.
const realLoad = Module._load;
Module._load = function (request, ...rest) {
    return request === 'electron' ? { ipcMain: { on() {} }, Notification: class {} } : realLoad.call(this, request, ...rest);
};
const { pickThread, confirmThread, confirmPane, replyScript, SEL } = require('../src/utils/replyNotifications');
Module._load = realLoad;

// ---- pickThread / confirmThread / confirmPane: pure decisions on plain data (everything already lower case) -----------
const snap = (title, preview = '', active = false) => ({ titles: title ? [title] : [], preview, active });
const BODY = 'did you see the game last night';

test('pickThread: one exact-title row is used, whatever its preview says', () => {
    assert.deepStrictEqual(pickThread([snap('lee', 'ok'), snap('sam', BODY)], 'sam', BODY), { index: 1, kind: 'title', byText: false });
    assert.deepStrictEqual(pickThread([snap('sam', 'something newer arrived')], 'sam', BODY), { index: 0, kind: 'title', byText: false });
    assert.deepStrictEqual(pickThread([snap('sam', '')], 'sam', BODY), { index: 0, kind: 'title', byText: false });
});

test('pickThread: one exact-title row is used for a short or empty text', () => {
    assert.deepStrictEqual(pickThread([snap('sam', 'test')], 'sam', 'test'), { index: 0, kind: 'title', byText: false });
    assert.deepStrictEqual(pickThread([snap('sam', 'test')], 'sam', ''), { index: 0, kind: 'title', byText: false });
});

test('pickThread: one group row is used', () => {
    assert.deepStrictEqual(pickThread([snap('crew one', 'sam: dinner is at seven')], 'sam', BODY), { index: 0, kind: 'group', byText: false });
});

test('pickThread: duplicate exact titles with no preview match are ambiguous, never the first', () => {
    assert.deepStrictEqual(pickThread([snap('sam', 'one'), snap('sam', 'two')], 'sam', BODY), { error: 'thread-ambiguous' });
});

test('pickThread: duplicate exact titles with missing previews are ambiguous', () => {
    assert.deepStrictEqual(pickThread([snap('sam', ''), snap('sam', '')], 'sam', BODY), { error: 'thread-ambiguous' });
});

test('pickThread: duplicate exact titles are told apart by the one preview that contains the text', () => {
    const rows = [snap('sam', 'one'), snap('sam', 'sam: ' + BODY + '?'), snap('lee', 'ok')];
    assert.deepStrictEqual(pickThread(rows, 'sam', BODY), { index: 1, kind: 'title', byText: true });
});

test('pickThread: duplicate exact titles whose previews both contain the text are ambiguous', () => {
    assert.deepStrictEqual(pickThread([snap('sam', BODY), snap('sam', BODY)], 'sam', BODY), { error: 'thread-ambiguous' });
});

test('pickThread: a short text can still pick when exactly one preview has it, and is ambiguous when both do', () => {
    assert.deepStrictEqual(pickThread([snap('sam', 'ok'), snap('sam', 'no')], 'sam', 'ok'), { index: 0, kind: 'title', byText: true });
    assert.deepStrictEqual(pickThread([snap('sam', 'ok'), snap('sam', 'ok')], 'sam', 'ok'), { error: 'thread-ambiguous' });
});

test('pickThread: an empty text cannot pick between duplicates', () => {
    assert.deepStrictEqual(pickThread([snap('sam', 'a'), snap('sam', 'b')], 'sam', ''), { error: 'thread-ambiguous' });
});

test('pickThread: two group chats whose latest message is from the sender, no preview match, are ambiguous', () => {
    const rows = [snap('crew one', 'sam: dinner is at seven'), snap('crew two', 'sam: see you all there')];
    assert.deepStrictEqual(pickThread(rows, 'sam', BODY), { error: 'thread-ambiguous' });
});

test('pickThread: two group chats, one preview matches the text, picks that one', () => {
    const rows = [snap('crew one', 'sam: dinner is at seven'), snap('crew two', 'sam: ' + BODY)];
    assert.deepStrictEqual(pickThread(rows, 'sam', BODY), { index: 1, kind: 'group', byText: true });
});

test('pickThread: two group chats whose previews both match are ambiguous', () => {
    const rows = [snap('crew one', 'sam: ' + BODY), snap('crew two', 'sam: ' + BODY)];
    assert.deepStrictEqual(pickThread(rows, 'sam', BODY), { error: 'thread-ambiguous' });
});

test('pickThread: a row with a missing preview is not a group candidate at all', () => {
    assert.deepStrictEqual(pickThread([snap('crew one', '')], 'sam', BODY), { error: 'thread-not-found' });
});

test('pickThread: a title row and a group row both containing the text are ambiguous', () => {
    assert.deepStrictEqual(pickThread([snap('sam', BODY), snap('crew one', 'sam: ' + BODY)], 'sam', BODY), { error: 'thread-ambiguous' });
});

test('pickThread: a title row and a group row, the text only in the title row, picks the title row', () => {
    const rows = [snap('crew one', 'sam: earlier message here'), snap('sam', 'sam: ' + BODY)];
    assert.deepStrictEqual(pickThread(rows, 'sam', BODY), { index: 1, kind: 'title', byText: true });
});

test('pickThread: a title row and a group row, the text in neither, are ambiguous', () => {
    const rows = [snap('sam', 'newer text'), snap('crew one', 'sam: earlier message here')];
    assert.deepStrictEqual(pickThread(rows, 'sam', BODY), { error: 'thread-ambiguous' });
});

test('pickThread: no candidate is thread-not-found', () => {
    assert.deepStrictEqual(pickThread([snap('lee', 'ok')], 'sam', BODY), { error: 'thread-not-found' });
    assert.deepStrictEqual(pickThread([], 'sam', BODY), { error: 'thread-not-found' });
});

test('confirmThread: true only for the chosen row being the sole active row with the pane open', () => {
    const rows = [snap('lee', 'ok'), snap('sam', BODY, true)];
    assert.strictEqual(confirmThread(rows, 1, 'title', 'sam', true), true);
    assert.strictEqual(confirmThread(rows, 1, 'title', 'sam', false), false, 'pane not open');
    assert.strictEqual(confirmThread(rows, 0, 'title', 'sam', true), false, 'chosen row is not the active one');
    assert.strictEqual(confirmThread(rows, -1, 'title', 'sam', true), false, 'row left the list');
    assert.strictEqual(confirmThread([snap('lee', 'ok', true), snap('sam', BODY, true)], 1, 'title', 'sam', true), false, 'two active rows');
});

test('confirmThread: the row must still show the sender it was chosen for', () => {
    assert.strictEqual(confirmThread([snap('lee', 'now another thread in this element', true)], 0, 'title', 'sam', true), false);
    assert.strictEqual(confirmThread([snap('crew', 'sam: anything', true)], 0, 'group', 'sam', true), true);
    assert.strictEqual(confirmThread([snap('crew', 'lee: anything', true)], 0, 'group', 'sam', true), false);
});

const paneOf = (over = {}) => ({ pane: true, composer: true, header: 'sam', text: 'sam ' + BODY, ...over });

test('confirmPane: accepts a pane that shows the sender and holds the message box', () => {
    assert.strictEqual(confirmPane(paneOf(), 'title', 'sam', BODY, false), '');
    assert.strictEqual(confirmPane(paneOf({ header: 'crew one', text: 'crew one sam: hello' }), 'group', 'sam', BODY, false), '');
});

test('confirmPane: the notification text is not required unless it chose the conversation', () => {
    assert.strictEqual(confirmPane(paneOf({ text: 'sam an older message only' }), 'title', 'sam', BODY, false), '');
    assert.strictEqual(confirmPane(paneOf({ text: 'sam an older message only' }), 'title', 'sam', BODY, true), 'pane-mismatch');
    assert.strictEqual(confirmPane(paneOf(), 'title', 'sam', '', true), 'pane-mismatch');
    assert.strictEqual(confirmPane(paneOf(), 'title', 'sam', BODY, true), '');
});

test('confirmPane: no pane or no header is a pane mismatch', () => {
    assert.strictEqual(confirmPane(paneOf({ pane: false }), 'title', 'sam', BODY, false), 'pane-mismatch');
    assert.strictEqual(confirmPane(paneOf({ header: '' }), 'title', 'sam', BODY, false), 'pane-mismatch');
});

test('confirmPane: a message box outside the open pane is a composer mismatch', () => {
    assert.strictEqual(confirmPane(paneOf({ composer: false }), 'title', 'sam', BODY, false), 'composer-mismatch');
});

test('confirmPane: a pane showing someone else is a pane mismatch', () => {
    assert.strictEqual(confirmPane(paneOf({ header: 'lee' }), 'title', 'sam', BODY, false), 'pane-mismatch');
    assert.strictEqual(confirmPane(paneOf({ header: 'crew one', text: 'crew one lee: hello' }), 'group', 'sam', BODY, false), 'pane-mismatch');
});

// ---- the whole reply script, run against a tiny fake of the Google Voice page ---------------------------------------
// A row may set paneTitle / paneText to say what the conversation pane shows once that row is open (default: its own
// title and preview).  composerOutsidePane puts the message box outside the pane, to model different markup.
function makePage({ rows, draft = '', path = '/u/0/messages', composerOutsidePane = false }) {
    const page = { clicks: [], sent: [], onType: null };
    class FakeText {
        get value() { return this._v || ''; }
        set value(v) { this._v = v; if (page.onType) { page.onType(); } }
    }
    class FakeInput {}
    const textarea = Object.assign(new FakeText(), { tagName: 'TEXTAREA', isContentEditable: false, focus() {}, dispatchEvent() {} });
    textarea._v = draft;
    const send = {
        disabled: false, tagName: 'BUTTON', title: '',
        getAttribute: (n) => (n === 'aria-label' ? 'Send message' : null),
        click() { page.sent.push(textarea.value); textarea.value = ''; }
    };
    page.textarea = textarea;
    page.rows = rows.map((r) => {
        const titleEl = { childNodes: [{ nodeType: 3, nodeValue: r.title || '' }] };
        const previewEl = { textContent: r.preview || '', childNodes: [{ nodeType: 3, nodeValue: r.preview || '' }] };
        const container = { click() { page.clicks.push(r.id); page.rows.forEach((x) => { x.active = false; }); row.active = true; } };
        const row = {
            id: r.id, active: !!r.active,
            paneTitle: r.paneTitle !== undefined ? r.paneTitle : (r.title || ''),
            paneText: r.paneText !== undefined ? r.paneText : (r.title || '') + ' ' + (r.preview || ''),
            querySelectorAll: () => [titleEl, previewEl],
            querySelector(sel) {
                if (sel === SEL.preview) { return previewEl; }
                if (sel === SEL.activeRow) { return row.active ? container : null; }
                if (sel === SEL.rowClick) { return container; }
                return null;
            }
        };
        return row;
    });
    const activeRow = () => page.rows.find((x) => x.active) || null;
    const pane = {
        querySelector(sel) {
            const a = activeRow();
            if (sel === SEL.header) { return a ? { textContent: a.paneTitle } : null; }
            if (sel === SEL.input) { return composerOutsidePane ? null : textarea; }
            if (sel === SEL.entry) { return { querySelectorAll: () => [send] }; }
            return null;
        },
        get textContent() { const a = activeRow(); return a ? a.paneText : ''; }
    };
    const document = {
        querySelectorAll: (sel) => (sel === SEL.thread ? page.rows : sel === SEL.input ? [textarea] : []),
        querySelector: (sel) => {
            if (sel === SEL.pane) { return activeRow() ? pane : null; }
            if (sel === SEL.header) { return activeRow() ? {} : null; }
            return null;
        }
    };
    page.ctx = vm.createContext({
        document, location: { pathname: path }, setTimeout,
        Event: class { constructor(type) { this.type = type; } },
        HTMLTextAreaElement: FakeText, HTMLInputElement: FakeInput
    });
    return page;
}
const run = (page, title, text, body, dry = false) => vm.runInContext(replyScript(title, text, body, dry), page.ctx);
const nothingHappened = (page) => { assert.deepStrictEqual(page.sent, []); assert.strictEqual(page.textarea.value, ''); };

test('reply: a successful unambiguous reply is sent to the right conversation', async () => {
    const page = makePage({ rows: [{ id: 'lee', title: 'lee', preview: 'ok' }, { id: 'sam', title: 'sam', preview: BODY }] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'ok');
    assert.deepStrictEqual(page.clicks, ['sam']);
    assert.deepStrictEqual(page.sent, ['yes']);
});

test('reply: a short incoming text ("test") to a lone conversation is sent', async () => {
    const page = makePage({ rows: [{ id: 'sam', title: 'sam', preview: 'test' }] });
    assert.strictEqual(await run(page, 'Sam', 'got it', 'test'), 'ok');
    assert.deepStrictEqual(page.clicks, ['sam']);
    assert.deepStrictEqual(page.sent, ['got it']);
});

test('reply: an already open, unambiguous conversation is used without clicking', async () => {
    const page = makePage({ rows: [{ id: 'sam', title: 'sam', preview: BODY, active: true }, { id: 'lee', title: 'lee', preview: 'ok' }] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'ok');
    assert.deepStrictEqual(page.clicks, []);
    assert.deepStrictEqual(page.sent, ['yes']);
});

test('reply: a lone exact title whose preview has moved on still gets the reply', async () => {
    const page = makePage({ rows: [{ id: 'sam', title: 'sam', preview: 'a newer message arrived' }] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'ok');
    assert.deepStrictEqual(page.sent, ['yes']);
});

test('reply: two group chats from the same sender with no preview match send nothing and click nothing', async () => {
    const page = makePage({ rows: [
        { id: 'g1', title: 'crew one', preview: 'sam: dinner is at seven' },
        { id: 'g2', title: 'crew two', preview: 'sam: see you all there' }
    ] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'thread-ambiguous');
    assert.deepStrictEqual(page.clicks, []);
    nothingHappened(page);
});

test('reply: two group chats where one preview matches go to that one', async () => {
    const page = makePage({ rows: [
        { id: 'g1', title: 'crew one', preview: 'sam: dinner is at seven' },
        { id: 'g2', title: 'crew two', preview: 'sam: ' + BODY }
    ] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'ok');
    assert.deepStrictEqual(page.clicks, ['g2']);
    assert.deepStrictEqual(page.sent, ['yes']);
});

test('reply: duplicate exact titles with nothing to tell them apart send nothing', async () => {
    const page = makePage({ rows: [{ id: 'd1', title: 'sam', preview: 'one' }, { id: 'd2', title: 'sam', preview: 'two' }] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'thread-ambiguous');
    assert.deepStrictEqual(page.clicks, []);
    nothingHappened(page);
});

test('reply: duplicate exact titles are refused even when one of them is already open', async () => {
    const page = makePage({ rows: [{ id: 'd1', title: 'sam', preview: 'one', active: true }, { id: 'd2', title: 'sam', preview: 'two' }] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'thread-ambiguous');
    assert.deepStrictEqual(page.clicks, []);
    nothingHappened(page);
});

test('reply: duplicate exact titles with one matching preview go to that one', async () => {
    const page = makePage({ rows: [{ id: 'd1', title: 'sam', preview: 'one' }, { id: 'd2', title: 'sam', preview: BODY }] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'ok');
    assert.deepStrictEqual(page.clicks, ['d2']);
});

test('reply: a text that chose between duplicates must also be in the open pane', async () => {
    const page = makePage({ rows: [
        { id: 'd1', title: 'sam', preview: 'one' },
        { id: 'd2', title: 'sam', preview: BODY, paneText: 'sam an older message only' }
    ] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'pane-mismatch');
    nothingHappened(page);
});

test('reply: a lone group row is used even when its preview has moved on', async () => {
    const page = makePage({ rows: [{ id: 'g1', title: 'crew one', preview: 'sam: dinner is at seven' }] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'ok');
    assert.deepStrictEqual(page.clicks, ['g1']);
});

test('reply: a group row with a missing preview sends nothing', async () => {
    const page = makePage({ rows: [{ id: 'g1', title: 'crew one', preview: '' }] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'thread-not-found');
    assert.deepStrictEqual(page.clicks, []);
    nothingHappened(page);
});

test('reply: the row is selected but the pane shows a different conversation: nothing is typed or sent', async () => {
    const page = makePage({ rows: [{ id: 'sam', title: 'sam', preview: BODY, paneTitle: 'lee', paneText: 'lee ' + BODY }] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'pane-mismatch');
    nothingHappened(page);
});

test('reply: a pane with no header text is not accepted', async () => {
    const page = makePage({ rows: [{ id: 'sam', title: 'sam', preview: BODY, paneTitle: '' }] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'pane-mismatch');
    nothingHappened(page);
});

test('reply: a message box that is not inside the open pane is never typed into', async () => {
    const page = makePage({ composerOutsidePane: true, rows: [{ id: 'sam', title: 'sam', preview: BODY }] });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'composer-mismatch');
    nothingHappened(page);
});

test('reply: an unsent draft blocks the switch, even when the message box sits outside the pane', async () => {
    const page = makePage({
        composerOutsidePane: true,
        draft: 'half typed',
        rows: [{ id: 'lee', title: 'lee', preview: 'ok', active: true }, { id: 'sam', title: 'sam', preview: BODY }]
    });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'draft-present');
    assert.deepStrictEqual(page.clicks, []);
    assert.deepStrictEqual(page.sent, []);
    assert.strictEqual(page.textarea.value, 'half typed');
});

test('reply: an unsent draft in another conversation blocks the switch', async () => {
    const page = makePage({
        draft: 'half typed',
        rows: [{ id: 'lee', title: 'lee', preview: 'ok', active: true }, { id: 'sam', title: 'sam', preview: BODY }]
    });
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'draft-present');
    assert.deepStrictEqual(page.clicks, []);
    assert.deepStrictEqual(page.sent, []);
    assert.strictEqual(page.textarea.value, 'half typed');
});

test('reply: if the open thread changes while typing, nothing is sent and the draft is put back', async () => {
    const page = makePage({ rows: [{ id: 'sam', title: 'sam', preview: BODY }, { id: 'lee', title: 'lee', preview: 'ok' }] });
    let flipped = false;
    page.onType = () => { if (!flipped) { flipped = true; page.rows[1].active = true; } };   // another row becomes selected
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'thread-mismatch');
    assert.deepStrictEqual(page.sent, []);
    assert.strictEqual(page.textarea.value, '');
});

test('reply: if the pane switches to another conversation while typing, nothing is sent', async () => {
    const page = makePage({ rows: [{ id: 'sam', title: 'sam', preview: BODY }] });
    let flipped = false;
    page.onType = () => { if (!flipped) { flipped = true; page.rows[0].paneTitle = 'lee'; page.rows[0].paneText = 'lee ' + BODY; } };
    assert.strictEqual(await run(page, 'Sam', 'yes', BODY), 'pane-mismatch');
    assert.deepStrictEqual(page.sent, []);
    assert.strictEqual(page.textarea.value, '');
});

test('reply: a dry run confirms the thread and pane but sends nothing', async () => {
    const page = makePage({ rows: [{ id: 'sam', title: 'sam', preview: BODY }] });
    assert.match(await run(page, 'Sam', 'yes', BODY, true), /^ok-dryrun/);
    assert.deepStrictEqual(page.sent, []);
});

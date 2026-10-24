const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const guard = require('../src/utils/ipcGuard');

// A stand-in for an ipcMain event: which web contents sent it and from which frame.
const contents = { id: 1 };
const other = { id: 2 };
const event = (sender, url, parent = null) => ({ sender, senderFrame: url === undefined ? null : { url, parent } });

test('only the top frame of the Voice page in the right window is the Voice page', () => {
    assert.strictEqual(guard.senderIsVoicePage(event(contents, 'https://voice.google.com/u/0/messages'), contents), true);
    assert.strictEqual(guard.senderIsVoicePage(event(other, 'https://voice.google.com/u/0/messages'), contents), false, 'other window');
    assert.strictEqual(guard.senderIsVoicePage(event(contents, 'https://voice.google.com/u/0/', { url: 'x' }), contents), false, 'sub-frame');
    assert.strictEqual(guard.senderIsVoicePage(event(contents, 'https://accounts.google.com/'), contents), false, 'sign-in page');
    assert.strictEqual(guard.senderIsVoicePage(event(contents, 'https://voice.google.com.evil.test/'), contents), false, 'look-alike');
    assert.strictEqual(guard.senderIsVoicePage(event(contents, 'file:///tmp/x.html'), contents), false, 'local file');
    assert.strictEqual(guard.senderIsVoicePage(event(contents, undefined), contents), false, 'frame already gone');
    assert.strictEqual(guard.senderIsVoicePage(event(contents, 'https://voice.google.com/'), null), false, 'no window yet');
    assert.strictEqual(guard.senderIsVoicePage(null, contents), false);
});

test('a local page is trusted only in its own window, top frame, showing exactly its own file', () => {
    const file = path.join('/app', 'src', 'pages', 'customize.html');
    const url = pathToFileURL(file).href;
    assert.strictEqual(guard.senderIsLocalPage(event(contents, url), contents, file), true);
    assert.strictEqual(guard.senderIsLocalPage(event(contents, url + '?x=1#top'), contents, file), true);
    assert.strictEqual(guard.senderIsLocalPage(event(other, url), contents, file), false, 'other window');
    assert.strictEqual(guard.senderIsLocalPage(event(contents, url, { url: 'x' }), contents, file), false, 'sub-frame');
    assert.strictEqual(guard.senderIsLocalPage(event(contents, pathToFileURL('/app/src/pages/other.html').href), contents, file), false, 'other file');
    assert.strictEqual(guard.senderIsLocalPage(event(contents, 'https://voice.google.com/'), contents, file), false, 'web page');
    assert.strictEqual(guard.senderIsLocalPage(event(contents, 'file:///app/src/pages/customize.html.evil'), contents, file), false);
    assert.strictEqual(guard.senderIsLocalPage(event(contents, undefined), contents, file), false);
});

test('notifications from the page are checked for shape and size, and a clean copy is returned', () => {
    const good = { id: 3, title: 'Alice', body: 'hi', tag: 't', silent: false };
    assert.deepStrictEqual(guard.cleanNotification({ ...good, extra: { a: 1 } }), good, 'unknown fields are dropped');
    for (const bad of [
        null, undefined, 'x', [], 5,
        { ...good, id: -1 }, { ...good, id: 1.5 }, { ...good, id: '3' }, { ...good, id: 2 ** 40 },
        { ...good, title: 5 }, { ...good, title: 'x'.repeat(501) }, { ...good, body: 'x'.repeat(5001) }, { ...good, tag: {} },
        { ...good, silent: 'no' }, { id: 1 }
    ]) {
        assert.strictEqual(guard.cleanNotification(bad), null, JSON.stringify(bad));
    }
    assert.notStrictEqual(guard.cleanNotification({ ...good, body: 'x'.repeat(5000) }), null, 'the size limit itself is allowed');
});

test('unread counts are whole numbers in a sensible range', () => {
    assert.strictEqual(guard.cleanCount(0), 0);
    assert.strictEqual(guard.cleanCount(7), 7);
    for (const bad of [-1, 1.5, NaN, Infinity, '3', null, undefined, {}, 100000]) { assert.strictEqual(guard.cleanCount(bad), null, String(bad)); }
});

test('theme ids can never be a path', () => {
    for (const ok of ['default', 'm3-rose-dark', 'dracula', 'darkplus']) { assert.strictEqual(guard.isThemeId(ok), true, ok); }
    for (const bad of ['', '../x', '..', 'a/b', 'a\\b', '/etc/passwd', 'x.scss', 'UPPER', '-lead', 'a b', 'a'.repeat(41), null, 5, {}]) {
        assert.strictEqual(guard.isThemeId(bad), false, String(bad));
    }
});

test('basic value checks', () => {
    assert.ok(guard.isBool(true) && guard.isBool(false) && !guard.isBool(1) && !guard.isBool('true'));
    assert.ok(guard.isInt(0) && guard.isInt(5, 1, 5) && !guard.isInt(6, 1, 5) && !guard.isInt(1.2) && !guard.isInt('1'));
    assert.ok(guard.isNum(0.5, 0, 1) && !guard.isNum(NaN) && !guard.isNum(Infinity) && !guard.isNum('1') && !guard.isNum(2, 0, 1));
});

test('the rate limiter lets a few through and then waits for the window to pass', () => {
    let t = 1000;
    const allow = guard.createRateLimiter(3, 10000, () => t);
    assert.deepStrictEqual([allow(), allow(), allow(), allow()], [true, true, true, false]);
    t += 9999;
    assert.strictEqual(allow(), false);
    t += 2;
    assert.strictEqual(allow(), true);
});

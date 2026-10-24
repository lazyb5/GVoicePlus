const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const windowPrefs = require('../src/utils/windowPrefs');
const topBar = require('../src/utils/topBar');

const src = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

test('every window runs sandboxed, with Node off and context isolation on', () => {
    const all = {
        page: windowPrefs.page({ preload: '/p.js', spellcheck: true }),
        settings: windowPrefs.settings({ preload: '/s.js' }),
        titleBar: windowPrefs.titleBar({ preload: '/t.js' })
    };
    for (const [name, prefs] of Object.entries(all)) {
        assert.strictEqual(prefs.nodeIntegration, false, name);
        assert.strictEqual(prefs.contextIsolation, true, name);
        assert.strictEqual(prefs.sandbox, true, name);
        assert.strictEqual(prefs.webviewTag, false, name);
        assert.strictEqual(prefs.nodeIntegrationInSubFrames, false, name);
        assert.strictEqual(prefs.nodeIntegrationInWorker, false, name);
        assert.strictEqual(prefs.allowRunningInsecureContent, false, name);
        assert.ok(prefs.preload.endsWith('.js'), name + ' has its own preload');
    }
    assert.strictEqual(all.page.backgroundThrottling, false);   // hidden window must keep replying (see windowPrefs.js)
});

test('no source file turns an unsafe window setting back on', () => {
    const files = ['main.js', 'preload.js', 'settingsPreload.js', 'titlebarPreload.js', path.join('utils', 'windowPrefs.js')];
    for (const f of files) {
        const text = src(f);
        assert.ok(!/nodeIntegration\s*:\s*true/.test(text), f + ': nodeIntegration: true');
        assert.ok(!/contextIsolation\s*:\s*false/.test(text), f + ': contextIsolation: false');
        assert.ok(!/sandbox\s*:\s*false/.test(text), f + ': sandbox: false');
        assert.ok(!/webSecurity\s*:\s*false/.test(text), f + ': webSecurity: false');
        assert.ok(!/enableRemoteModule|allowRunningInsecureContent\s*:\s*true/.test(text), f);
    }
});

test('a sandboxed preload can load nothing but Electron itself', () => {
    for (const f of ['preload.js', 'settingsPreload.js', 'titlebarPreload.js']) {
        const requires = [...src(f).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
        assert.deepStrictEqual(requires, ['electron'], f);
    }
});

test('the pages of the Settings window and the title bar strip use no Node', () => {
    for (const f of [path.join('pages', 'customize.js'), path.join('pages', 'titlebar.js'), path.join('pages', 'titlebar.html'), path.join('pages', 'customize.html')]) {
        const text = src(f);
        assert.ok(!/\brequire\s*\(/.test(text), f + ' calls require');
        assert.ok(!/ipcRenderer/.test(text), f + ' uses ipcRenderer');
        assert.ok(!/process\.platform/.test(text), f + ' reads process');
    }
});

test('both local pages forbid inline scripts and outside content', () => {
    for (const f of ['customize.html', 'titlebar.html']) {
        const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(src(path.join('pages', f)));
        assert.ok(csp, f + ' has a CSP');
        assert.ok(/default-src 'none'/.test(csp[1]), f);
        assert.ok(/script-src 'self'(;|$)/.test(csp[1]), f + ' scripts only from the page\'s own files');
        assert.ok(!/unsafe-eval|http:|https:|\*/.test(csp[1]), f + ' no outside sources');
    }
});

test('shell.openExternal is only called from the one checked helper', () => {
    const calls = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['themes', 'vendor'].includes(e.name)) { walk(full); } }
        else if (e.name.endsWith('.js')) {
            fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => { if (/shell\.openExternal\(/.test(line)) { calls.push(`${path.relative(path.join(__dirname, '..'), full)}:${i + 1}`); } });
        }
    });
    walk(path.join(__dirname, '..', 'src'));
    // main.js: the openExternalSafe helper.  updateCheck.js: its default when none is passed in (main.js always passes the helper).
    assert.deepStrictEqual(calls.map((c) => c.replace(/:\d+$/, '')).sort(), ['src/main.js', 'src/utils/updateCheck.js']);
    assert.ok(/openExternal:\s*\(url\)\s*=>\s*openExternalSafe\(url\)/.test(src('main.js')), 'main.js passes the checked helper to the update check');
});

test('every ipcMain handler in main.js is registered through a sender check', () => {
    const main = src('main.js');
    const direct = [...main.matchAll(/ipcMain\.(on|handle)\(\s*'([^']+)'/g)].map((m) => m[2]);
    assert.deepStrictEqual(direct, ['gv-init'], 'only gv-init is registered directly (and it checks the sender itself)');
    assert.ok(/ipcMain\.on\('gv-init'[\s\S]{0,200}senderIsPage\(event\)/.test(main));
});

test('the top-bar key list matches the items the page script knows', () => {
    const keys = [...topBar.SOURCE.matchAll(/\{ key: '(\w+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual(topBar.KEYS, keys);
});

test('the gv-init reply is assigned to event.returnValue exactly once', () => {
    // Electron treats the first value given to event.returnValue as the reply and ignores later ones.  An early
    // "returnValue = null" followed by the real answer leaves the page's preload with null: it starts nothing (no
    // notifications, unread badge, sidebar tweaks).  Found by running the real preload under sandbox: true.
    const main = src('main.js');
    const start = main.indexOf("ipcMain.on('gv-init'");
    assert.ok(start > 0, 'gv-init handler exists');
    const end = main.indexOf('\n});', start);
    const handler = main.slice(start, end);
    assert.strictEqual((handler.match(/returnValue\s*=/g) || []).length, 1, 'one assignment, on every path');
});

test('the sign-in landing page host is allowed in the app window, look-alikes are not', () => {
    const policy = require('../src/utils/urlPolicy');
    assert.ok(policy.APP_HOSTS.has('workspace.google.com'));   // where voice.google.com sends a signed-out visitor
    assert.strictEqual(policy.isAppUrl('https://workspace.google.com.evil.test/'), false);
});

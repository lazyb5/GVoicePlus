'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { APP_USER_MODEL_ID, startMenuShortcutPaths } = require('../src/utils/startMenuShortcut');

test('app user model id differs from the installer appId, so the installer shortcut never claims our window', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.notStrictEqual(APP_USER_MODEL_ID, pkg.build.appId);
    assert.ok(APP_USER_MODEL_ID.length > 0);
});

test('shortcut paths end in <name>.lnk under Start Menu/Programs', () => {
    const p = startMenuShortcutPaths('/a', '/b', 'GVoicePlus');
    for (const f of [p.user, p.all]) {
        assert.ok(f.endsWith('GVoicePlus.lnk'));
        assert.ok(f.includes('Start Menu'));
    }
    assert.ok(p.user.startsWith(path.join('/a')));
    assert.ok(p.all.startsWith(path.join('/b')));
});

test('main.js rewrites the shortcut at startup and whenever the icon changes (Windows)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    assert.strictEqual((src.match(/refreshStartMenuShortcut\(\)/g) || []).length, 3);   // the definition, startup and applyIconSet
    assert.ok(!/setAppDetails/.test(src));
});

test('after rewriting the shortcut the shell is told icons changed, with a fixed command (no user input)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const refresh = src.slice(src.indexOf('function refreshStartMenuShortcut'), src.indexOf('let shellNotifyTimer'));
    assert.ok(/notifyShellIconsChanged\(\)/.test(refresh));
    const notify = src.slice(src.indexOf('function notifyShellIconsChanged'), src.indexOf('function notifyShellIconsChanged') + 900);
    assert.ok(/execFile\('powershell\.exe'/.test(notify));
    assert.ok(!/\$\{/.test(notify));   // no template substitution in the command
});

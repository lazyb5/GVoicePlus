'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { APP_USER_MODEL_ID, startMenuShortcutPaths, shouldWriteShortcut } = require('../src/utils/startMenuShortcut');

test('app user model id matches the installer appId in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.strictEqual(APP_USER_MODEL_ID, pkg.build.appId);
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

test('writes our own shortcut only when neither location has one', () => {
    const p = startMenuShortcutPaths('/a', '/b', 'GVoicePlus');
    assert.strictEqual(shouldWriteShortcut(p, () => false), true);
    assert.strictEqual(shouldWriteShortcut(p, (f) => f === p.user), false);
    assert.strictEqual(shouldWriteShortcut(p, (f) => f === p.all), false);
    assert.strictEqual(shouldWriteShortcut(p, () => true), false);
});

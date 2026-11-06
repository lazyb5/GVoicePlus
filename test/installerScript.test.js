'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('the installer makes no Start Menu shortcut of its own (the app writes one with the chosen icon)', () => {
    assert.strictEqual(pkg.build.nsis.createStartMenuShortcut, false);
});

test('the uninstaller removes the shortcut and icon files the app wrote', () => {
    const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
    assert.ok(/!macro customUnInstall/.test(nsh));
    assert.ok(/!macroend/.test(nsh));
    assert.ok(/Start Menu\\Programs\\GVoicePlus\.lnk/.test(nsh));
    assert.ok(/voice-desktop-app\\taskbar-\*\.ico/.test(nsh));
    assert.ok(!/SetShellVarContext/.test(nsh));   // must not change the installer's shell context
});

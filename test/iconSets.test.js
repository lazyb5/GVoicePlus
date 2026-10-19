const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const iconSets = require('../src/utils/iconSets');

test('unknown or missing choices fall back to the default set', () => {
    for (const bad of [undefined, null, '', 'nope', 42, '__proto__', 'constructor', 'toString']) {
        assert.strictEqual(iconSets.get(bad).id, iconSets.DEFAULT);
        assert.strictEqual(iconSets.has(bad), false);
    }
});

test('the default set exists and is listed', () => {
    assert.strictEqual(iconSets.has(iconSets.DEFAULT), true);
    assert.ok(iconSets.list().some((s) => s.id === iconSets.DEFAULT));
});

test('every image a set names exists in the images folder', () => {
    for (const id of Object.keys(iconSets.SETS)) {
        const set = iconSets.get(id);
        for (const key of ['dock', 'window', 'tray', 'trayDirty']) {
            assert.ok(set[key], `${id}.${key} is not set`);
            assert.ok(fs.existsSync(path.join(__dirname, '..', 'images', set[key])), `${id}.${key} -> ${set[key]} is missing`);
        }
    }
});

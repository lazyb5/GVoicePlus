const test = require('node:test');
const assert = require('node:assert');
const { isNewer, hasFileFor } = require('../src/utils/updateCheck');

const assets = (...names) => names.map((name) => ({ name }));

test('isNewer compares versions and ignores a leading v', () => {
    assert.strictEqual(isNewer('v1.0.1', '1.0.0'), true);
    assert.strictEqual(isNewer('v1.0.0', '1.0.0'), false);
    assert.strictEqual(isNewer('v1.0.0', '1.0.1'), false);
});

test('a Mac release is not an update for Windows, and the other way round', () => {
    const macOnly = assets('GVoicePlus-1.0.1-arm64.dmg', 'GVoicePlus-1.0.1-arm64-mac.zip');
    const winOnly = assets('GVoicePlus-Setup-1.0.1-x64.exe');
    assert.strictEqual(hasFileFor(macOnly, 'darwin'), true);
    assert.strictEqual(hasFileFor(macOnly, 'win32'), false);
    assert.strictEqual(hasFileFor(winOnly, 'win32'), true);
    assert.strictEqual(hasFileFor(winOnly, 'darwin'), false);
});

test('Linux and missing or odd asset lists never count', () => {
    assert.strictEqual(hasFileFor(assets('GVoicePlus-1.0.1-arm64.dmg', 'a.exe'), 'linux'), false);
    assert.strictEqual(hasFileFor(undefined, 'darwin'), false);
    assert.strictEqual(hasFileFor([], 'win32'), false);
    assert.strictEqual(hasFileFor([null, {}], 'win32'), false);
});

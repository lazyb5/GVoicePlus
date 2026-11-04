const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const iconSets = require('../src/utils/iconSets');
const { drawBadge } = require('../src/utils/customIcon');
const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

test('every colourway has a source picture the Mac colour menu bar icon can be drawn from', () => {
    for (const id of Object.keys(iconSets.SETS)) {
        const file = path.join(root, 'images', iconSets.get(id).dock);
        assert.ok(fs.existsSync(file), file);
    }
});

test('the default menu bar icon on a Mac is still the template image, and the setting is off by default', () => {
    assert.strictEqual(require('../src/constants').DEFAULT_COLOUR_MENU_BAR_ICON, false);
    assert.ok(read('src', 'utils', 'iconSets.js').includes("mac ? 'icons/menubar/trayTemplate.png'"));
});

test('the setting is wired through the validated channel and only changes the icon on a Mac', () => {
    const main = read('src', 'main.js');
    assert.ok(/listen\(senderIsSettings, 'pref-change-colour-menu-bar-icon', isBool/.test(main));
    assert.ok(/setColourMenuBarIcon: send\('pref-change-colour-menu-bar-icon', isBool\)/.test(read('src', 'settingsPreload.js')));
    assert.ok(main.includes("process.platform === 'darwin' && store.get('prefs.colourMenuBarIcon') === true"));
    assert.ok(/MAC_MENU_BAR = \{ size: 40/.test(main));
});

test('the Mac menu bar dot is visible but does not cover the icon, and is vivid red; defaults are unchanged', () => {
    const size = 40;
    const bmp = Buffer.alloc(size * size * 4);
    const mac = /MAC_MENU_BAR = \{ size: 40, badge: ([\d.]+), inner: ([\d.]+)/.exec(read('src', 'main.js'));
    assert.ok(mac);
    drawBadge(bmp, size, { badge: +mac[1], inner: +mac[2], red: [0xff, 0x3b, 0x30] });
    let covered = 0, vivid = 0;
    for (let i = 0; i < bmp.length; i += 4) {
        if (bmp[i + 3]) { covered++; }
        if (bmp[i + 2] === 0xff && bmp[i + 1] === 0x3b) { vivid++; }
    }
    const share = covered / (size * size);
    assert.ok(share > 0.10 && share < 0.20, `badge covers ${(share * 100).toFixed(1)}% of the icon`);
    assert.ok(vivid > 100, 'red centre is big enough to see');
    const old = Buffer.alloc(32 * 32 * 4); drawBadge(old, 32);
    assert.ok(old.some((v, i) => i % 4 === 2 && v === 0xe5));   // the original red is still the default
});

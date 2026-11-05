'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pngToIco } = require('../src/utils/icoFile');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');   // a PNG signature and the start of its header

test('pngToIco writes a one-image icon directory pointing at the PNG data', () => {
    const ico = pngToIco(PNG);
    assert.strictEqual(ico.readUInt16LE(0), 0);
    assert.strictEqual(ico.readUInt16LE(2), 1);                // icon
    assert.strictEqual(ico.readUInt16LE(4), 1);                // one image
    assert.strictEqual(ico[6], 0);                             // 256 wide
    assert.strictEqual(ico[7], 0);                             // 256 high
    assert.strictEqual(ico.readUInt32LE(14), PNG.length);      // data size
    assert.strictEqual(ico.readUInt32LE(18), 22);              // data offset
    assert.strictEqual(ico.length, 22 + PNG.length);
    assert.ok(ico.subarray(22).equals(PNG));
});

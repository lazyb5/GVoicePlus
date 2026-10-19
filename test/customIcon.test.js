const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { padToSquare, drawBadge, pngFromIcns } = require('../src/utils/customIcon');

const pixel = (buf, size, x, y) => Array.from(buf.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));
const solid = (w, h, rgba) => Buffer.from(Array.from({ length: w * h }, () => rgba).flat());

test('a non-square picture is centred on a transparent square', () => {
    const src = solid(4, 2, [10, 20, 30, 255]);
    const out = padToSquare(src, 4, 2, 8);
    assert.strictEqual(out.length, 8 * 8 * 4);
    assert.deepStrictEqual(pixel(out, 8, 2, 3), [10, 20, 30, 255]);   // top-left of the picture
    assert.deepStrictEqual(pixel(out, 8, 5, 4), [10, 20, 30, 255]);   // bottom-right of the picture
    for (const [x, y] of [[0, 0], [7, 7], [1, 3], [6, 4], [3, 2], [3, 5]]) {
        assert.deepStrictEqual(pixel(out, 8, x, y), [0, 0, 0, 0], `(${x},${y}) should be transparent`);
    }
});

test('a square picture of the full size is copied unchanged', () => {
    const src = solid(4, 4, [1, 2, 3, 255]);
    assert.deepStrictEqual(padToSquare(src, 4, 4, 4), src);
});

test('the unread dot is drawn top-right and leaves the rest alone', () => {
    const size = 32;
    const bmp = Buffer.alloc(size * size * 4);
    drawBadge(bmp, size);
    assert.deepStrictEqual(pixel(bmp, size, 24, 8), [0x2a, 0x25, 0xe5, 255]);   // red centre (BGRA)
    assert.deepStrictEqual(pixel(bmp, size, 0, 31), [0, 0, 0, 0]);
    assert.deepStrictEqual(pixel(bmp, size, 0, 0), [0, 0, 0, 0]);
    let white = 0, red = 0, untouched = 0;
    for (let i = 0; i < size * size; i++) {
        const [b, g, r, a] = pixel(bmp, size, i % size, Math.floor(i / size));
        if (a === 0) { untouched++; } else if (r === 255 && g === 255 && b === 255) { white++; } else { red++; }
    }
    assert.ok(white > 10 && red > 50, `expected a ring and a dot, got white=${white} red=${red}`);
    assert.ok(untouched > 800);
});

// A tiny icns: header, a 16 px "TOC" style entry that is not a PNG, and two PNG entries of different sizes.
const png = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(n, 7)]);
const entry = (type, data) => { const h = Buffer.alloc(8); h.write(type, 0, 'latin1'); h.writeUInt32BE(8 + data.length, 4); return Buffer.concat([h, data]); };
const icns = (...entries) => { const body = Buffer.concat(entries); const h = Buffer.alloc(8); h.write('icns', 0, 'latin1'); h.writeUInt32BE(8 + body.length, 4); return Buffer.concat([h, body]); };

test('the biggest PNG inside an icns file is found', () => {
    const small = png(20), big = png(200);
    const found = pngFromIcns(icns(entry('is32', Buffer.alloc(50, 1)), entry('ic07', small), entry('ic10', big), entry('ic08', png(100))));
    assert.deepStrictEqual(found, big);
});

test('files that are not usable icns data give null', () => {
    assert.strictEqual(pngFromIcns(Buffer.from('not an icon file at all')), null);
    assert.strictEqual(pngFromIcns(icns(entry('is32', Buffer.alloc(50, 1)))), null);   // no PNG entries
    assert.strictEqual(pngFromIcns(Buffer.alloc(3)), null);
    const cut = icns(entry('ic10', png(200))); cut.writeUInt32BE(9999, 12);            // an entry claiming to be longer than the file
    assert.strictEqual(pngFromIcns(cut), null);
});

test('the app\'s own icns file contains a PNG', { skip: !fs.existsSync(path.join(__dirname, '..', 'build', 'icon.icns')) }, () => {
    const found = pngFromIcns(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.icns')));
    assert.ok(found && found.readUInt32BE(0) === 0x89504e47);
});

'use strict';

// Wraps one 256x256 PNG in an .ico container (Windows Vista and later accept PNG data inside an .ico).
// In an .ico directory entry a width/height byte of 0 means 256.
function pngToIco(png) {
    const head = Buffer.alloc(22);
    head.writeUInt16LE(0, 0);            // reserved
    head.writeUInt16LE(1, 2);            // type: icon
    head.writeUInt16LE(1, 4);            // one image
    head[6] = 0; head[7] = 0;            // 256 x 256
    head[8] = 0; head[9] = 0;            // no palette, reserved
    head.writeUInt16LE(1, 10);           // colour planes
    head.writeUInt16LE(32, 12);          // bits per pixel
    head.writeUInt32LE(png.length, 14);  // size of the image data
    head.writeUInt32LE(22, 18);          // offset of the image data
    return Buffer.concat([head, png]);
}

module.exports = { pngToIco };

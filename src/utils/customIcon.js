/**********************************************************************************************************************
 * "Choose your own image" for the app icon.  The picture is shrunk to fit a 512 px transparent square and saved in the
 * app's data folder (so it keeps working if the original is moved or deleted).  It becomes the Dock and window icon.
 * On Windows and Linux it is also the tray icon, with the red unread dot drawn on for the unread state.  On a Mac the
 * menu bar icon stays a built-in one, because it has to be a single-colour "template" image.
 **********************************************************************************************************************/
const fs = require('fs');

const SIZE = 512;   // the saved picture is this many pixels square

// The pixel helpers work on raw BGRA bitmaps (4 bytes per pixel, the format Electron's nativeImage uses).  They don't
// need Electron, so they are tested on their own.

// Centres a w x h picture on a transparent size x size canvas.
function padToSquare(bitmap, w, h, size = SIZE) {
    const out = Buffer.alloc(size * size * 4);
    const ox = Math.floor((size - w) / 2);
    const oy = Math.floor((size - h) / 2);
    for (let y = 0; y < h; y++) {
        bitmap.copy(out, ((y + oy) * size + ox) * 4, y * w * 4, (y + 1) * w * 4);
    }
    return out;
}

// Draws a red "unread" dot with a white ring in the top-right corner of a size x size bitmap, in place.
function drawBadge(bitmap, size) {
    const outer = size * 0.24;
    const inner = outer * 0.74;
    const cx = size - outer - 0.5;
    const cy = outer + 0.5;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > outer) { continue; }
            const red = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= inner;
            const i = (y * size + x) * 4;
            bitmap[i] = red ? 0x2a : 255;       // blue
            bitmap[i + 1] = red ? 0x25 : 255;   // green
            bitmap[i + 2] = red ? 0xe5 : 255;   // red
            bitmap[i + 3] = 255;
        }
    }
}

// An .icns file is a list of (4-letter type, length, data) entries.  Electron can't open it directly, but the larger sizes
// inside are ordinary PNGs, so this returns the biggest PNG it holds (as a Buffer), or null if there is none.
function pngFromIcns(buf) {
    if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'icns') { return null; }
    let best = null;
    for (let pos = 8; pos + 8 <= buf.length;) {
        const length = buf.readUInt32BE(pos + 4);
        if (length < 8 || pos + length > buf.length) { break; }
        const data = buf.subarray(pos + 8, pos + length);
        if (data.length > 8 && data.readUInt32BE(0) === 0x89504e47 && (!best || data.length > best.length)) { best = data; }
        pos += length;
    }
    return best;
}

// Reads a picture, fits it inside a SIZE x SIZE transparent square and saves it as a PNG.  Returns false when the file
// is not a usable image.
function prepare(sourceFile, destFile) {
    const { nativeImage } = require('electron');
    let image;
    if (/\.icns$/i.test(sourceFile)) {
        const png = pngFromIcns(fs.readFileSync(sourceFile));
        image = png ? nativeImage.createFromBuffer(png) : nativeImage.createEmpty();
    } else {
        image = nativeImage.createFromPath(sourceFile);
    }
    if (image.isEmpty()) { return false; }
    const { width, height } = image.getSize();
    const scale = SIZE / Math.max(width, height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    image = image.resize({ width: w, height: h, quality: 'best' });
    const bitmap = image.toBitmap();
    if (bitmap.length !== w * h * 4) { return false; }
    const square = padToSquare(bitmap, w, h);
    const temp = destFile + '.tmp';
    fs.writeFileSync(temp, nativeImage.createFromBitmap(square, { width: SIZE, height: SIZE }).toPNG());
    fs.renameSync(temp, destFile);
    return true;
}

// The Windows/Linux tray images made from the saved picture: normal, and with the unread dot.
function trayImages(file) {
    const { nativeImage } = require('electron');
    const small = nativeImage.createFromPath(file).resize({ width: 32, height: 32, quality: 'best' });
    const plain = Buffer.from(small.toBitmap());
    if (plain.length !== 32 * 32 * 4) { throw new Error('unexpected icon size'); }
    const dirty = Buffer.from(plain);
    drawBadge(dirty, 32);
    const make = (bitmap) => nativeImage.createFromBitmap(bitmap, { width: 32, height: 32, scaleFactor: 2 });
    return { plain: make(plain), dirty: make(dirty) };
}

// Shows the file picker.  Resolves to 'ok' (saved to destFile), 'cancelled' or 'not-an-image'.
async function pick(parentWindow, destFile) {
    const { dialog } = require('electron');
    // Electron reads .icns only on a Mac and .ico only on Windows, so each is offered only where it can be opened.
    const extensions = ['png', 'jpg', 'jpeg'].concat(process.platform === 'darwin' ? ['icns'] : [], process.platform === 'win32' ? ['ico'] : []);
    const options = { title: 'Choose an icon image', properties: ['openFile'], filters: [{ name: 'Images and icon files', extensions }] };
    const result = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) { return 'cancelled'; }
    try { return prepare(result.filePaths[0], destFile) ? 'ok' : 'not-an-image'; } catch (e) { return 'not-an-image'; }
}

module.exports = { SIZE, padToSquare, drawBadge, pngFromIcns, prepare, trayImages, pick };

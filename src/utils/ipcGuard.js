/**********************************************************************************************************************
 * Checks for messages that arrive from a window's page over IPC.
 *
 * Every ipcMain handler in main.js asks two questions before doing anything:
 *   1. WHO sent it?  The right window, the top frame of it, showing the page we expect (senderIs...).
 *   2. WHAT did it send?  A value of the expected type and size (the is... checks), never an object that is passed on
 *      untouched.
 * A message that fails either check is ignored (sync calls get null back) and logged without its contents.
 *
 * No Electron code in this file: events are only read (event.sender, event.senderFrame), so it is unit-tested on its own
 * (test/ipcGuard.test.js).
 **********************************************************************************************************************/

const { pathToFileURL } = require('url');
const urlPolicy = require('./urlPolicy');

// ---- who sent it -----------------------------------------------------------------------------------------------------

function frameOf(event) {
    try { return (event && event.senderFrame) || null; } catch (e) { return null; }
}

function isTopFrame(frame) {
    try { return !!frame && (frame.parent === null || frame.parent === undefined); } catch (e) { return false; }
}

const sameContents = (event, contents) => !!event && !!contents && !!event.sender && event.sender === contents;

// The Google Voice page (https://voice.google.com) in the given web contents, top frame only.
function senderIsVoicePage(event, contents) {
    const frame = frameOf(event);
    return sameContents(event, contents) && isTopFrame(frame) && urlPolicy.isVoiceUrl(frame.url);
}

// One of our own local pages (settings, title bar): the given web contents, top frame, showing exactly that file.
// Query strings and fragments are ignored.
function senderIsLocalPage(event, contents, filePath) {
    const frame = frameOf(event);
    if (!sameContents(event, contents) || !isTopFrame(frame)) { return false; }
    try {
        const url = new URL(frame.url);
        const want = pathToFileURL(filePath);
        return url.protocol === 'file:' && url.pathname === want.pathname;
    } catch (e) { return false; }
}

// ---- what it sent ----------------------------------------------------------------------------------------------------

const isBool = (v) => typeof v === 'boolean';
const isInt = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min = -Infinity, max = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isText = (v, maxLength) => typeof v === 'string' && v.length <= maxLength;
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// A theme id such as "m3-rose-dark" or "dracula".  Letters, digits and hyphens only, so it can never be a path.
const THEME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const isThemeId = (v) => typeof v === 'string' && THEME_ID.test(v);

// The notification the page's stand-in (notificationShim.js) forwards.  Returns a clean copy, or null when the message is
// not shaped like one.
function cleanNotification(data) {
    if (!isPlainObject(data)) { return null; }
    const { id, title, body, tag, silent } = data;
    if (!isInt(id, 0, 2147483647) || !isText(title, 500) || !isText(body, 5000) || !isText(tag, 500) || !isBool(silent)) { return null; }
    return { id, title, body, tag, silent };
}

// Unread counts are whole numbers; anything else from the page is ignored.
const cleanCount = (v) => (isInt(v, 0, 99999) ? v : null);

// Allows at most `limit` events per `windowMs`.  Used so a page cannot flood the system with notifications.
function createRateLimiter(limit, windowMs, now = Date.now) {
    let stamps = [];
    return () => {
        const t = now();
        stamps = stamps.filter((s) => t - s < windowMs);
        if (stamps.length >= limit) { return false; }
        stamps.push(t);
        return true;
    };
}

module.exports = {
    frameOf, isTopFrame, senderIsVoicePage, senderIsLocalPage,
    isBool, isInt, isNum, isText, isPlainObject, isThemeId, THEME_ID, cleanNotification, cleanCount, createRateLimiter
};

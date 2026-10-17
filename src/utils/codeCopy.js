/**********************************************************************************************************************
 * Copies verification (2FA) codes from incoming message notifications to the clipboard, then clears the clipboard
 * again after a minute (only if it still holds that code, so something you copied since is never wiped).
 *
 * Off unless the "Copy verification codes" setting (prefs.copyCodes) is ticked.  It reads the notification text that
 * notificationShim.js already forwards to the main process; nothing else is read and the code is never logged.
 **********************************************************************************************************************/

const CLEAR_AFTER_MS = 60 * 1000;
const MAX_BODY_LENGTH = 400;   // verification texts are short; long messages are far more likely to be false positives

// Words that must appear near a number for it to count as a code.  "Strong" words are enough on their own; the
// weaker "log in / sign in" phrasing is accepted too, except for numbers that look like years.
const STRONG = /\b(?:code|otp|passcode|pin|verification|verify|one[- ]?time|2fa|two[- ]factor|authentication|security)\b/ig;
const WEAK = /\b(?:log[- ]?in|sign[- ]?in)\b/ig;
const YEAR_WORDS = /\b(?:code|otp|passcode|pin)\b/ig;

// 4-8 digits, or 3+3 digits split by a space or hyphen ("123 456").  Not part of a longer number, phone number,
// amount, date, time, percentage or order number, and not stuck to letters ("KB5034441").  "G-123456" is fine
// (a letter, then a hyphen).
// Also not the tail of a longer digit group ("555 123 4567", "ID 123 456 789").
const CANDIDATE = /(?<![\d$€£#.,:/+A-Za-z])(?<!\d[ -])(\d{3}[ -]\d{3}|\d{4,8})(?!\d|[A-Za-z]|[ -]\d|[.,:/]\d|%)/g;

// Numbers that sit next to a "keyword" but are really something else: "account ending 4821", "2500 USD",
// "12345 Oak Ave", "Happy 2026!".  Checked against the text just before / after the candidate.
const NOT_CODE_BEFORE = /\b(?:ending(?:\s+in)?|ends?\s+in|acct|ref(?:erence)?|order|invoice|confirmation|tracking|apt|suite|unit)\s*[:#.]?\s*$/i;
const NOT_CODE_AFTER = /^\s*(?:usd|eur|gbp|dollars?|euros?|bucks)\b|^\s+(?:\w+\s+)?(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pkwy|hwy|highway)\b|^!/i;
const NOT_YEAR_BEFORE = /\b(?:happy|year|since|copyright|in|of)\s*$/i;
const FOUR_DIGIT_MAX_DISTANCE = 30;   // short codes need their keyword closer; the usual wording is "code is 1234"

function positions(re, text) {
    const out = [];
    for (const m of text.matchAll(new RegExp(re.source, 'ig'))) { out.push(m.index); }
    return out;
}

// Returns the code as digits only (spaces/hyphens removed), or null when the text does not look like a code message.
function extractCode(body) {
    const text = String(body || '');
    if (!text || text.length > MAX_BODY_LENGTH) { return null; }

    const strong = positions(STRONG, text);
    const weak = positions(WEAK, text);
    const yearWords = positions(YEAR_WORDS, text);
    if (!strong.length && !weak.length) { return null; }

    const nearest = (list, at) => list.reduce((best, p) => Math.min(best, Math.abs(p - at)), Infinity);
    let best = null;
    for (const m of text.matchAll(CANDIDATE)) {
        const digits = m[1].replace(/\D/g, '');
        const at = m.index;
        const before = text.slice(Math.max(0, at - 24), at);
        const after = text.slice(at + m[1].length, at + m[1].length + 24);
        const looksLikeYear = digits.length === 4 && /^(19|20)\d\d$/.test(digits);
        if (NOT_CODE_BEFORE.test(before) || NOT_CODE_AFTER.test(after)) { continue; }
        if (looksLikeYear && NOT_YEAR_BEFORE.test(before)) { continue; }
        const distance = looksLikeYear
            ? nearest(yearWords, at)
            : Math.min(nearest(strong, at), digits.length >= 6 ? nearest(weak, at) : Infinity);   // "sign in" alone only counts for 6+ digits
        if (distance > (digits.length === 4 && !looksLikeYear ? FOUR_DIGIT_MAX_DISTANCE : 60)) { continue; }
        if (!best || distance < best.distance) { best = { digits, distance }; }
    }
    return best ? best.digits : null;
}

// The clipboard behaviour, with everything it touches passed in so it can be tested without a real clipboard.
function createCopier({ clipboard, getPrefs, notify = () => {}, log = () => {}, clearAfterMs = CLEAR_AFTER_MS,
                        setTimer = setTimeout, clearTimer = clearTimeout }) {
    let timer = null;
    let current = null;   // the code we put on the clipboard and have not cleared yet

    function clearIfOurs() {
        if (timer) { clearTimer(timer); timer = null; }
        if (current !== null) {
            if (clipboard.readText() === current) { clipboard.clear(); log('clipboard cleared'); }
            else { log('clipboard changed since; left alone'); }
            current = null;
        }
    }

    return {
        onNotification(body) {
            const prefs = getPrefs() || {};
            if (!prefs.copyCodes) { return null; }
            const code = extractCode(body);
            if (!code) { return null; }
            if (timer && code === current) { return code; }   // same message notified twice: nothing new to do
            if (timer) { clearTimer(timer); }
            clipboard.writeText(code);
            current = code;
            timer = setTimer(clearIfOurs, clearAfterMs);
            if (timer && typeof timer.unref === 'function') { timer.unref(); }
            log(`copied a ${code.length}-digit code`);
            notify();
            return code;
        },
        flush: clearIfOurs
    };
}

module.exports.extractCode = extractCode;
module.exports.createCopier = createCopier;

module.exports.init = function ({ getPrefs }) {
    const { clipboard, app } = require('electron');
    const ts = () => new Date().toISOString().slice(11, 23);
    const copier = createCopier({
        clipboard,
        getPrefs,
        log: (m) => console.log(`${ts()} [code] ${m}`)
    });
    app.on('will-quit', () => { try { copier.flush(); } catch (e) { /* ignore */ } });
    // Called by replyNotifications.js for each message notification, before the banner is shown.  Returns the code
    // when one was copied (so the banner can say so), otherwise null.  Never throws.
    return {
        handle(body) {
            try { return copier.onNotification(body); }
            catch (e) { console.log(`${ts()} [code] error: ${e && e.message}`); return null; }
        }
    };
};

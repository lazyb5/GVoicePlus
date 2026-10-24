/**********************************************************************************************************************
 * Which web addresses the main window may go to, and which ones may be handed to the operating system.
 *
 * Everything here parses with the standard WHATWG URL class (never the old url.parse, which reads "a\@b" and similar
 * tricks differently from the browser) and compares exact host names, so "voice.google.com.example.com" or
 * "https://voice.google.com@example.com" never count as Google Voice.  No Electron code in this file, so it is
 * unit-tested on its own (test/urlPolicy.test.js).
 **********************************************************************************************************************/

const MAX_URL_LENGTH = 4096;

// Pages the main window itself may show (top-level navigation and redirects), https only.
//   voice.google.com        the app (any /u/<n>/ account)
//   accounts.google.com     Google sign-in, account chooser, 2-step prompts
//   accounts.youtube.com    part of Google's sign-in cookie hand-off
//   workspace.google.com    Google's own landing page, where voice.google.com sends a signed-out visitor (a new profile
//                           or a signed-out session) before the "Sign in" button leads on to accounts.google.com
// Anything else (for example a Google Workspace single-sign-on provider) is not shown in the app window; it opens in the
// person's normal browser instead.
const APP_HOSTS = new Set(['voice.google.com', 'accounts.google.com', 'accounts.youtube.com', 'workspace.google.com']);

// Only the Google Voice page itself gets the app's own hooks (notifications, unread count, sidebar tweaks, themes).
// The sign-in pages are left exactly as Google serves them.
const VOICE_ORIGIN = 'https://voice.google.com';

// What may be opened outside the app with shell.openExternal.  Nothing that starts another program (file:, smb:,
// ms-msdt:, custom app schemes, javascript:, data: and so on).
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

function parse(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) { return null; }
    // Browsers silently drop tabs and newlines inside a URL; refuse them (and other control characters) outright so
    // there is only one reading of the address.
    if (/[\u0000-\u001f\u007f]/.test(value)) { return null; }
    try {
        const u = new URL(value);
        // For web addresses, require the plain "scheme://host" shape.  The URL class quietly repairs "https:///host" or
        // "https:\\host" into a normal address; refuse such spellings instead of guessing what was meant.
        if ((u.protocol === 'https:' || u.protocol === 'http:') && !/^https?:\/\/[^\/\\]/i.test(value)) { return null; }
        return u;
    } catch (e) { return null; }
}

const hasCredentials = (u) => u.username !== '' || u.password !== '';

// True for an address the main window may navigate to: https, an app host, no user:password@, default port.
function isAppUrl(value) {
    const u = parse(value);
    return !!u && u.protocol === 'https:' && APP_HOSTS.has(u.hostname) && !hasCredentials(u) && u.port === '';
}

// True for the Google Voice page itself (https://voice.google.com/...).
function isVoiceUrl(value) {
    const u = parse(value);
    return !!u && u.origin === VOICE_ORIGIN && !hasCredentials(u);
}

// The signed-in app: https://voice.google.com/u/<n>/...  (the only pages that get a theme).
function isSignedInVoiceUrl(value) {
    const u = parse(value);
    return !!u && u.origin === VOICE_ORIGIN && /^\/u\/\d+(\/|$)/.test(u.pathname);
}

// Returns the normalised address to pass to shell.openExternal, or null when it must not be opened.
function externalUrl(value) {
    const u = parse(value);
    if (!u || !EXTERNAL_PROTOCOLS.has(u.protocol)) { return null; }
    if ((u.protocol === 'https:' || u.protocol === 'http:') && (!u.hostname || hasCredentials(u))) { return null; }
    return u.href;
}

// What to do with a link or navigation the page asked for:
//   'app'      show it in the main window
//   'external' open it in the person's browser (or mail program)
//   'block'    do nothing
function classify(value) {
    if (isAppUrl(value)) { return 'app'; }
    return externalUrl(value) ? 'external' : 'block';
}

module.exports = { APP_HOSTS, VOICE_ORIGIN, EXTERNAL_PROTOCOLS, MAX_URL_LENGTH, parse, isAppUrl, isVoiceUrl, isSignedInVoiceUrl, externalUrl, classify };

/**********************************************************************************************************************
 * Which web permissions Google's page may use.  Installed on the one session every window shares (default session) as
 * BOTH of Electron's handlers, because most web APIs check a permission (the check handler) before they ask for it (the
 * request handler), and the two are not given the same information:
 *
 *   request handler  (webContents, permission, callback, details)
 *       webContents is always given.  details: requestingUrl, isMainFrame; for 'media' also securityOrigin and
 *       mediaTypes (a LIST, "audio" and/or "video").
 *   check handler    (webContents, permission, requestingOrigin, details)
 *       webContents can be null (checks not made for a document, e.g. 'notifications' and service workers).  The origin
 *       is the separate requestingOrigin argument.  details: isMainFrame, requestingUrl, embeddingOrigin, and for 'media'
 *       mediaType (ONE of "audio", "video", "unknown").
 *       Electron 44.9.3 does NOT behave exactly as its docs say here (checked against the real thing, see the "real Electron
 *       44.9.3 arguments" test): embeddingOrigin is set on EVERY check, to the top-level page's origin (the docs say only for
 *       cross-origin subframes), and securityOrigin is never supplied for media checks (the docs say it is).  So a check
 *       relies on the always-present requestingOrigin; embeddingOrigin and securityOrigin, when present, must ALSO be exactly
 *       the Voice origin.  Nothing is loosened beyond that: a present value that does not match is still a refusal.
 *
 * The policy is deliberately small.  Everything not listed here is refused, including every permission name Electron
 * documents today, any name it adds later, and anything with missing or odd request information:
 *   - 'media': microphone only (calls).  A request that includes video, or whose media kind is missing, is refused.
 *   - 'notifications': the Voice page's own notification checks.
 * and only when ALL of this holds:
 *   - the permission name is exactly one of the two above (compared as a string, case-sensitive);
 *   - it comes from the Voice page's own web contents (null contents is accepted only for 'notifications' checks, which
 *     Electron documents as having none);
 *   - it comes from the main frame (isMainFrame is exactly true; a subframe such as an embedded widget gets nothing), and
 *     the page is not embedded in someone else's page (an embeddingOrigin, when Electron supplies one, is exactly the Voice
 *     origin too);
 *   - the origin parses (WHATWG URL, never prefix matching) to exactly https://voice.google.com, with no user:password@.
 *
 * Nothing here widens access to make a feature work.  Every refusal (and the first grant of each kind) is logged with the
 * permission name and the ORIGIN only (never a full address, which can carry tokens), so a feature that stops working
 * can be traced to the exact permission and origin.
 *
 * No Electron code in this file, so it is unit-tested on its own (test/permissionPolicy.test.js).
 **********************************************************************************************************************/

const urlPolicy = require('./urlPolicy');

const ALLOWED = new Set(['media', 'notifications']);

const isObject = (v) => !!v && typeof v === 'object';

// An "origin" value (requestingOrigin, securityOrigin): exactly https://voice.google.com, nothing else.  Electron may
// spell it with or without the trailing slash; no path, query, fragment, credentials or non-default port is accepted.
function isVoiceOrigin(value) {
    const u = urlPolicy.parse(value);
    return !!u && u.href === urlPolicy.VOICE_ORIGIN + '/' && u.origin === urlPolicy.VOICE_ORIGIN;
}

// An address (requestingUrl): any page on exactly https://voice.google.com.
const isVoiceAddress = (value) => urlPolicy.isVoiceUrl(value);

const deny = (reason) => ({ allow: false, reason });
const allow = (reason) => ({ allow: true, reason });

// Only plain permission names go into a log line.
const safeName = (value) => (typeof value === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(value)) ? value : '(odd name)';

// The origin of an address or origin value, for logging only.
function originForLog(value) {
    const u = urlPolicy.parse(value);
    return u && u.origin && u.origin !== 'null' ? u.origin.slice(0, 100) : '(none or unparseable)';
}

// ---- the decisions (pure) --------------------------------------------------------------------------------------------

// input: { permission, fromVoicePage (bool), details }
function decideRequest(input) {
    const { permission, fromVoicePage, details } = isObject(input) ? input : {};
    if (typeof permission !== 'string' || !ALLOWED.has(permission)) { return deny('permission not allowed'); }
    if (fromVoicePage !== true) { return deny('not the Voice page'); }
    if (!isObject(details)) { return deny('no request details'); }
    if (details.isMainFrame !== true) { return deny('not the main frame'); }
    if (typeof details.requestingUrl !== 'string' || !isVoiceAddress(details.requestingUrl)) { return deny('requesting address is not Google Voice'); }
    if (permission === 'media') {
        const kinds = details.mediaTypes;
        if (!Array.isArray(kinds) || kinds.length === 0) { return deny('media kinds missing'); }
        if (!kinds.every((k) => k === 'audio')) { return deny('media request is not audio only'); }
        if (!isVoiceOrigin(details.securityOrigin)) { return deny('media security origin missing or not Google Voice'); }
    }
    return allow('ok');
}

// input: { permission, fromVoicePage (bool), hasContents (bool), requestingOrigin, details }
function decideCheck(input) {
    const { permission, fromVoicePage, hasContents, requestingOrigin, details } = isObject(input) ? input : {};
    if (typeof permission !== 'string' || !ALLOWED.has(permission)) { return deny('permission not allowed'); }
    if (hasContents === true) {
        if (fromVoicePage !== true) { return deny('not the Voice page'); }
    } else if (permission !== 'notifications') {
        return deny('no web contents for this permission');   // Electron documents null contents for notification checks only
    }
    if (!isObject(details)) { return deny('no check details'); }
    if (details.isMainFrame !== true) { return deny('not the main frame'); }
    if (details.embeddingOrigin !== undefined && !isVoiceOrigin(details.embeddingOrigin)) { return deny('embedded in another origin'); }
    if (!isVoiceOrigin(requestingOrigin)) { return deny('requesting origin is not Google Voice'); }
    if (details.requestingUrl !== undefined && (typeof details.requestingUrl !== 'string' || !isVoiceAddress(details.requestingUrl))) {
        return deny('requesting address is not Google Voice');
    }
    if (permission === 'media') {
        if (details.mediaType !== 'audio') { return deny('media check is not audio'); }
        // securityOrigin is not supplied by Electron 44.9.3 for checks; when something supplies one it must match.
        if (details.securityOrigin !== undefined && !isVoiceOrigin(details.securityOrigin)) { return deny('media security origin is not Google Voice'); }
    }
    return allow('ok');
}

// ---- wiring ----------------------------------------------------------------------------------------------------------

// Installs both handlers on the given session.  getPageContents() returns the Voice page's web contents (or null).
// Failures inside a handler always mean "refused": the callback is called exactly once, the check returns false.
function install(ses, { getPageContents, log = () => {} }) {
    const seen = new Set();
    const note = (kind, permission, origin, extra, decision) => {
        const key = [kind, permission, origin, extra, decision.allow, decision.reason].join('|');
        if (seen.has(key) || seen.size >= 200) { return; }
        seen.add(key);
        log(`[perm] ${kind} ${safeName(permission)} ${decision.allow ? 'granted' : 'REFUSED'} origin=${origin}${extra} (${decision.reason})`);
    };
    const isPage = (contents) => { try { const page = getPageContents(); return !!contents && !!page && contents === page; } catch (e) { return false; } };

    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
        let decision = deny('internal error');
        try {
            decision = decideRequest({ permission, fromVoicePage: isPage(contents), details });
            const d = isObject(details) ? details : {};
            note('request', permission, originForLog(d.securityOrigin || d.requestingUrl),
                ` main=${d.isMainFrame}${Array.isArray(d.mediaTypes) ? ' media=' + d.mediaTypes.map(safeName).join(',') : ''}`, decision);
        } catch (e) { /* refused */ }
        try { callback(decision.allow === true); } catch (e) { /* nothing more to do */ }
    });

    ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
        let decision = deny('internal error');
        try {
            decision = decideCheck({ permission, fromVoicePage: isPage(contents), hasContents: !!contents, requestingOrigin, details });
            const d = isObject(details) ? details : {};
            note('check', permission, originForLog(requestingOrigin),
                ` main=${d.isMainFrame}${typeof d.mediaType === 'string' ? ' media=' + safeName(d.mediaType) : ''}${contents ? '' : ' contents=null'}`, decision);
        } catch (e) { /* refused */ }
        return decision.allow === true;
    });
}

module.exports = { ALLOWED, isVoiceOrigin, decideRequest, decideCheck, install };

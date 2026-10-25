const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const policy = require('../src/utils/permissionPolicy');

const VOICE = 'https://voice.google.com';
const PAGE = { id: 'page' };
const OTHER = { id: 'settings window or another view' };

// Every permission name Electron 44 documents for these handlers (docs/api/session.md), plus "unknown".
const DOCUMENTED = ['ar', 'automatic-fullscreen', 'background-fetch', 'background-sync', 'captured-surface-control', 'clipboard-read',
    'clipboard-sanitized-write', 'deprecated-sync-clipboard-read', 'display-capture', 'fileSystem', 'fullscreen', 'geolocation',
    'geolocation-approximate', 'hand-tracking', 'hid', 'idle-detection', 'keyboardLock', 'local-fonts', 'local-network',
    'local-network-access', 'loopback-network', 'media', 'mediaKeySystem', 'midi', 'midiSysex', 'nfc', 'notifications', 'openExternal',
    'payment-handler', 'periodic-background-sync', 'persistent-storage', 'pointerLock', 'screen-wake-lock', 'sensors', 'serial',
    'smart-card', 'speaker-selection', 'storage-access', 'system-wake-lock', 'top-level-storage-access', 'usb', 'vr',
    'web-app-installation', 'web-printing', 'window-management', 'unknown'];

const reqMedia = (over = {}) => ({ permission: 'media', fromVoicePage: true,
    details: { requestingUrl: VOICE + '/u/0/calls', isMainFrame: true, securityOrigin: VOICE + '/', mediaTypes: ['audio'], ...over } });
const reqNotif = (over = {}) => ({ permission: 'notifications', fromVoicePage: true,
    details: { requestingUrl: VOICE + '/u/0/messages', isMainFrame: true, ...over } });
const chkMedia = (over = {}, top = {}) => ({ permission: 'media', fromVoicePage: true, hasContents: true, requestingOrigin: VOICE + '/',
    details: { isMainFrame: true, embeddingOrigin: VOICE + '/', mediaType: 'audio', requestingUrl: VOICE + '/u/0/calls', ...over }, ...top });
const chkNotif = (over = {}, top = {}) => ({ permission: 'notifications', fromVoicePage: false, hasContents: false, requestingOrigin: VOICE + '/',
    details: { isMainFrame: true, ...over }, ...top });

const allowed = (d) => assert.strictEqual(d.allow, true, d.reason);
const refused = (d, why) => { assert.strictEqual(d.allow, false); if (why) { assert.match(d.reason, why); } };

test('request: microphone-only media from the Voice main frame is allowed', () => {
    allowed(policy.decideRequest(reqMedia()));
    allowed(policy.decideRequest(reqMedia({ requestingUrl: VOICE + '/' })));
    allowed(policy.decideRequest(reqMedia({ securityOrigin: VOICE })));
});

test('request: anything that includes video, or does not say what media it is, is refused', () => {
    for (const kinds of [['audio', 'video'], ['video'], ['video', 'audio'], [], undefined, null, 'audio', ['AUDIO'], ['audio', 'x'], [null], { 0: 'audio' }]) {
        refused(policy.decideRequest(reqMedia({ mediaTypes: kinds })));
    }
});

test('request: media needs its security origin to be exactly Google Voice', () => {
    for (const o of [undefined, null, '', 123, VOICE + '.evil.com', 'https://voice.google.com@evil.com', 'http://voice.google.com',
        'https://accounts.google.com', 'https://voice.google.com:8443', VOICE + '/u/0/calls', 'https://VOICE.google.com.evil.com', 'null']) {
        refused(policy.decideRequest(reqMedia({ securityOrigin: o })));
    }
});

test('request: subframes, unknown frames and the wrong web contents are refused', () => {
    for (const main of [false, undefined, null, 'true', 1, 0]) { refused(policy.decideRequest(reqMedia({ isMainFrame: main })), /main frame/); }
    refused(policy.decideRequest({ ...reqMedia(), fromVoicePage: false }), /Voice page/);
    refused(policy.decideRequest({ ...reqMedia(), fromVoicePage: undefined }), /Voice page/);
    refused(policy.decideRequest({ ...reqMedia(), fromVoicePage: 'yes' }), /Voice page/);
});

test('request: the requesting address must be a Google Voice page (parsed, not a prefix)', () => {
    for (const u of [undefined, null, '', 5, 'https://voice.google.com.evil.com/', 'https://voice.google.com@evil.com/', 'http://voice.google.com/',
        'https://accounts.google.com/', 'https://workspace.google.com/', 'https:///voice.google.com', 'https://evil.com/?https://voice.google.com/',
        'https://user:pw@voice.google.com/', 'javascript:alert(1)', 'file:///x', 'https://voice.google.com\n.evil.com/']) {
        refused(policy.decideRequest(reqMedia({ requestingUrl: u })));
        refused(policy.decideRequest(reqNotif({ requestingUrl: u })));
    }
});

test('request: missing or odd details are refused, never thrown on', () => {
    for (const d of [undefined, null, 5, 'x', true, []]) {
        refused(policy.decideRequest({ permission: 'media', fromVoicePage: true, details: d }));
        refused(policy.decideRequest({ permission: 'notifications', fromVoicePage: true, details: d }));
    }
    refused(policy.decideRequest());
    refused(policy.decideRequest({}));
    refused(policy.decideRequest(null));
});

test('request: notifications from the Voice main frame are allowed, from elsewhere refused', () => {
    allowed(policy.decideRequest(reqNotif()));
    refused(policy.decideRequest(reqNotif({ isMainFrame: false })));
    refused(policy.decideRequest({ ...reqNotif(), fromVoicePage: false }));
});

test('both handlers: every other documented permission, and any odd name, is refused', () => {
    for (const name of DOCUMENTED.filter((n) => n !== 'media' && n !== 'notifications')) {
        refused(policy.decideRequest({ ...reqMedia(), permission: name }), /permission not allowed/);
        refused(policy.decideCheck({ ...chkMedia(), permission: name }), /permission not allowed/);
        refused(policy.decideCheck({ ...chkNotif(), permission: name }), /permission not allowed/);
    }
    for (const name of ['', 'MEDIA', 'Media', 'media ', ' media', 'media\n', 'notifications\u0000', 'camera', 'microphone', 'audio-capture', 'video-capture',
        undefined, null, 0, 1, {}, [], ['media'], { toString: () => 'media' }, new String('media'), 'a'.repeat(5000)]) {
        refused(policy.decideRequest({ ...reqMedia(), permission: name }));
        refused(policy.decideCheck({ ...chkMedia(), permission: name }));
        refused(policy.decideCheck({ ...chkNotif(), permission: name }));
    }
    assert.deepStrictEqual([...policy.ALLOWED].sort(), ['media', 'notifications']);
});

test('check: audio media from the Voice main frame is allowed; video, unknown or missing kind is refused', () => {
    allowed(policy.decideCheck(chkMedia()));
    allowed(policy.decideCheck(chkMedia({ requestingUrl: undefined })));
    for (const kind of ['video', 'unknown', undefined, null, '', 'AUDIO', ['audio'], 1]) { refused(policy.decideCheck(chkMedia({ mediaType: kind })), /audio/); }
});

test('check: media needs web contents (null contents is only for notification checks) and the right ones', () => {
    refused(policy.decideCheck(chkMedia({}, { hasContents: false, fromVoicePage: false })), /no web contents/);
    refused(policy.decideCheck(chkMedia({}, { hasContents: false, fromVoicePage: true })), /no web contents/);
    refused(policy.decideCheck(chkMedia({}, { fromVoicePage: false })), /Voice page/);
    refused(policy.decideCheck(chkNotif({}, { hasContents: true, fromVoicePage: false })), /Voice page/);
});

test('check: notification checks with null contents are allowed only for the exact Voice main frame', () => {
    allowed(policy.decideCheck(chkNotif()));
    allowed(policy.decideCheck(chkNotif({ requestingUrl: VOICE + '/u/0/messages' })));
    allowed(policy.decideCheck(chkNotif({}, { hasContents: true, fromVoicePage: true })));
    refused(policy.decideCheck(chkNotif({ isMainFrame: false })), /main frame/);
    refused(policy.decideCheck(chkNotif({ isMainFrame: undefined })), /main frame/);
    allowed(policy.decideCheck(chkNotif({ embeddingOrigin: VOICE + '/' })));   // Electron 44.9.3 sets this on main-frame checks too
    allowed(policy.decideCheck(chkNotif({ embeddingOrigin: VOICE })));
    for (const e of ['https://evil.com', 'https://evil.com/', VOICE + '.evil.com/', 'http://voice.google.com/', null, '', 5, {}]) {
        refused(policy.decideCheck(chkNotif({ embeddingOrigin: e })), /another origin/);
        refused(policy.decideCheck(chkMedia({ embeddingOrigin: e })), /another origin/);
    }
    refused(policy.decideCheck(chkNotif({ requestingUrl: 'https://evil.com/' })), /address/);
    refused(policy.decideCheck(chkNotif({ requestingUrl: 7 })), /address/);
});

test('check: the origin is parsed exactly; look-alikes and odd spellings are refused', () => {
    for (const o of [undefined, null, '', 9, VOICE + '.evil.com', 'https://voice.google.com@evil.com', 'http://voice.google.com', 'https://accounts.google.com',
        'https://voice.google.com:8443', 'https://evil.com', 'https://evil.com/https://voice.google.com', VOICE + '/u/0/calls', VOICE + '/?x=1', VOICE + '/#x',
        'https://user:pw@voice.google.com', 'https:///voice.google.com', 'null', 'file:///', 'https://voice.google.com\n']) {
        refused(policy.decideCheck(chkMedia({}, { requestingOrigin: o })));
        refused(policy.decideCheck(chkNotif({}, { requestingOrigin: o })));
    }
    allowed(policy.decideCheck(chkMedia({}, { requestingOrigin: VOICE })));
    allowed(policy.decideCheck(chkMedia({}, { requestingOrigin: VOICE + '/' })));
});

test('check: media security origin is not supplied by Electron 44.9.3; when present it must be exactly Google Voice', () => {
    allowed(policy.decideCheck(chkMedia()));                                   // absent: the verified requestingOrigin identifies the origin
    allowed(policy.decideCheck(chkMedia({ securityOrigin: VOICE + '/' })));
    for (const o of [null, '', 5, 'https://evil.com', VOICE + '.evil.com', 'http://voice.google.com', VOICE + '/u/0/calls']) { refused(policy.decideCheck(chkMedia({ securityOrigin: o }))); }
});

test('check: missing or odd details are refused, never thrown on', () => {
    for (const d of [undefined, null, 5, 'x', true, []]) {
        refused(policy.decideCheck({ ...chkMedia(), details: d }));
        refused(policy.decideCheck({ ...chkNotif(), details: d }));
    }
    refused(policy.decideCheck());
    refused(policy.decideCheck({}));
    refused(policy.decideCheck(null));
});

// ---- the wiring ------------------------------------------------------------------------------------------------------

function fakeSession() {
    const s = { request: null, check: null };
    s.setPermissionRequestHandler = (fn) => { s.request = fn; };
    s.setPermissionCheckHandler = (fn) => { s.check = fn; };
    return s;
}
const goodRequestDetails = { requestingUrl: VOICE + '/u/0/calls', isMainFrame: true, securityOrigin: VOICE + '/', mediaTypes: ['audio'] };
const goodCheckDetails = { isMainFrame: true, embeddingOrigin: VOICE + '/', mediaType: 'audio', requestingUrl: VOICE + '/u/0/calls' };

test('install: sets BOTH handlers; the request callback is called exactly once with a boolean', () => {
    const ses = fakeSession(); const logs = [];
    policy.install(ses, { getPageContents: () => PAGE, log: (l) => logs.push(l) });
    assert.strictEqual(typeof ses.request, 'function');
    assert.strictEqual(typeof ses.check, 'function');
    const calls = [];
    ses.request(PAGE, 'media', (v) => calls.push(v), goodRequestDetails);
    ses.request(PAGE, 'media', (v) => calls.push(v), { ...goodRequestDetails, mediaTypes: ['audio', 'video'] });
    ses.request(OTHER, 'media', (v) => calls.push(v), goodRequestDetails);
    ses.request(PAGE, 'geolocation', (v) => calls.push(v), goodRequestDetails);
    ses.request(null, 'media', (v) => calls.push(v), goodRequestDetails);
    ses.request(PAGE, 'media', (v) => calls.push(v), undefined);
    assert.deepStrictEqual(calls, [true, false, false, false, false, false]);
});

test('install: the check handler returns true only for the allowed cases', () => {
    const ses = fakeSession();
    policy.install(ses, { getPageContents: () => PAGE });
    assert.strictEqual(ses.check(PAGE, 'media', VOICE + '/', goodCheckDetails), true);
    assert.strictEqual(ses.check(PAGE, 'media', VOICE + '/', { ...goodCheckDetails, mediaType: 'video' }), false);
    assert.strictEqual(ses.check(PAGE, 'media', 'https://evil.com/', goodCheckDetails), false);
    assert.strictEqual(ses.check(null, 'media', VOICE + '/', goodCheckDetails), false);
    assert.strictEqual(ses.check(OTHER, 'media', VOICE + '/', goodCheckDetails), false);
    assert.strictEqual(ses.check(null, 'notifications', VOICE + '/', { isMainFrame: true }), true);
    assert.strictEqual(ses.check(null, 'notifications', VOICE + '/', { isMainFrame: true, embeddingOrigin: 'https://evil.example/' }), false);
    assert.strictEqual(ses.check(PAGE, 'geolocation', VOICE + '/', { isMainFrame: true }), false);
    assert.strictEqual(ses.check(PAGE, 'clipboard-read', VOICE + '/', { isMainFrame: true }), false);
});

test('install: no page window yet (or a page lookup that throws) refuses instead of throwing', () => {
    for (const lookup of [() => null, () => undefined, () => { throw new Error('window gone'); }]) {
        const ses = fakeSession();
        policy.install(ses, { getPageContents: lookup });
        const calls = [];
        assert.doesNotThrow(() => ses.request(PAGE, 'media', (v) => calls.push(v), goodRequestDetails));
        assert.deepStrictEqual(calls, [false]);
        assert.strictEqual(ses.check(PAGE, 'media', VOICE + '/', goodCheckDetails), false);
    }
});

test('install: a throwing log function or callback never turns into a grant or a crash', () => {
    const ses = fakeSession();
    policy.install(ses, { getPageContents: () => PAGE, log: () => { throw new Error('log broke'); } });
    const calls = [];
    assert.doesNotThrow(() => ses.request(PAGE, 'media', (v) => calls.push(v), goodRequestDetails));
    assert.deepStrictEqual(calls, [true]);   // the log failing does not change a decision that was already made
    assert.doesNotThrow(() => ses.request(PAGE, 'media', () => { throw new Error('callback broke'); }, goodRequestDetails));
    const ses2 = fakeSession();
    policy.install(ses2, { getPageContents: () => PAGE, log: () => { throw new Error('log broke'); } });
    assert.strictEqual(ses2.check(PAGE, 'geolocation', VOICE + '/', { isMainFrame: true }), false);
});

test('install: logs name the permission and the origin only, never a full address, and each case once', () => {
    const ses = fakeSession(); const logs = [];
    policy.install(ses, { getPageContents: () => PAGE, log: (l) => logs.push(l) });
    const secret = { ...goodRequestDetails, requestingUrl: 'https://evil.example/path?token=SECRET123#frag', securityOrigin: 'https://evil.example' };
    for (let i = 0; i < 5; i++) { ses.request(PAGE, 'media', () => {}, secret); }
    ses.check(PAGE, 'geolocation', 'https://evil.example/', { isMainFrame: false });
    assert.strictEqual(logs.length, 2);
    assert.ok(logs.every((l) => l.startsWith('[perm] ')));
    assert.ok(logs.every((l) => !/SECRET123|token|\/path|#frag/.test(l)), logs.join('\n'));
    assert.match(logs[0], /request media REFUSED origin=https:\/\/evil\.example/);
    assert.match(logs[1], /check geolocation REFUSED origin=https:\/\/evil\.example/);
    ses.request(PAGE, 'weird name with spaces\nand newline', () => {}, goodRequestDetails);
    assert.ok(!/\n/.test(logs[logs.length - 1]) && /\(odd name\)/.test(logs[logs.length - 1]));
});

test('main.js installs the policy once, on the default session, before the first window', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    assert.strictEqual(main.split('permissionPolicy.install(').length - 1, 1);
    assert.match(main, /permissionPolicy\.install\(session\.defaultSession, /);
    assert.ok(main.indexOf('permissionPolicy.install(') < main.indexOf('createWindow();', main.indexOf('app.whenReady()')));
    assert.ok(!/setPermission(Request|Check)Handler\(/.test(main), 'handlers are only set through permissionPolicy.install');
    assert.ok(!/setPermission(Request|Check)Handler\(\s*null/.test(main));
});

// ---- the exact arguments real Electron 44.9.3 passed (captured with deny-all handlers on stand-in pages) -------------------
// check handler: contents is the window's contents even for frames; embeddingOrigin is the top-level origin on EVERY check;
// securityOrigin is absent for media; mediaType is "audio" or "video".  request handler: as documented.

test('real Electron 44.9.3 arguments: the Voice main frame gets the microphone and notifications, nothing else', () => {
    const top = { hasContents: true, fromVoicePage: true };
    const main = { isMainFrame: true, embeddingOrigin: 'https://voice.google.com/', requestingUrl: 'https://voice.google.com/' };
    allowed(policy.decideCheck({ permission: 'media', requestingOrigin: 'https://voice.google.com/', details: { ...main, mediaType: 'audio' }, ...top }));
    allowed(policy.decideCheck({ permission: 'notifications', requestingOrigin: 'https://voice.google.com/', details: main, ...top }));
    refused(policy.decideCheck({ permission: 'media', requestingOrigin: 'https://voice.google.com/', details: { ...main, mediaType: 'video' }, ...top }), /audio/);
    for (const p of ['geolocation', 'midi', 'clipboard-read', 'persistent-storage', 'screen-wake-lock', 'background-sync']) {
        refused(policy.decideCheck({ permission: p, requestingOrigin: 'https://voice.google.com/', details: main, ...top }), /permission not allowed/);
    }
});

test('real Electron 44.9.3 arguments: frames inside the page get nothing, same-origin or not', () => {
    const top = { hasContents: true, fromVoicePage: true };
    const sameOriginFrame = { isMainFrame: false, embeddingOrigin: 'https://voice.google.com/', requestingUrl: 'https://voice.google.com/frame' };
    const crossOriginFrame = { isMainFrame: false, embeddingOrigin: 'https://voice.google.com/', requestingUrl: 'https://other.test/frame' };
    for (const p of ['media', 'notifications']) {
        refused(policy.decideCheck({ permission: p, requestingOrigin: 'https://voice.google.com/', details: { ...sameOriginFrame, mediaType: 'audio' }, ...top }), /main frame/);
        refused(policy.decideCheck({ permission: p, requestingOrigin: 'https://other.test/', details: { ...crossOriginFrame, mediaType: 'audio' }, ...top }), /main frame/);
        // even if a frame wrongly claimed to be the main frame, another origin never passes
        refused(policy.decideCheck({ permission: p, requestingOrigin: 'https://other.test/', details: { ...crossOriginFrame, isMainFrame: true, mediaType: 'audio' }, ...top }), /origin/);
    }
});

test('real Electron 44.9.3 arguments: requests with audio only from the Voice main frame are granted; video or frames are not', () => {
    const base = { permission: 'media', fromVoicePage: true };
    const d = (over) => ({ isMainFrame: true, securityOrigin: 'https://voice.google.com/', mediaTypes: ['audio'], requestingUrl: 'https://voice.google.com/', ...over });
    allowed(policy.decideRequest({ ...base, details: d() }));
    refused(policy.decideRequest({ ...base, details: d({ mediaTypes: ['audio', 'video'] }) }), /audio only/);
    refused(policy.decideRequest({ ...base, details: d({ mediaTypes: ['video'] }) }), /audio only/);
    refused(policy.decideRequest({ ...base, details: d({ isMainFrame: false, requestingUrl: 'https://voice.google.com/frame' }) }), /main frame/);
    refused(policy.decideRequest({ ...base, details: d({ isMainFrame: false, securityOrigin: 'https://other.test/', requestingUrl: 'https://other.test/frame' }) }), /main frame/);
});

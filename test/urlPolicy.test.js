const test = require('node:test');
const assert = require('node:assert');
const policy = require('../src/utils/urlPolicy');

test('Google Voice, sign-in and account switching addresses stay in the app', () => {
    for (const url of [
        'https://voice.google.com',
        'https://voice.google.com/u/0/messages',
        'https://voice.google.com/u/3/calls?x=1#y',
        'https://accounts.google.com/ServiceLogin?service=grandcentral&continue=https%3A%2F%2Fvoice.google.com%2F',
        'https://accounts.google.com/v3/signin/challenge/pwd',
        'https://accounts.youtube.com/accounts/SetSID',
        'https://workspace.google.com/products/voice/',          // where a signed-out visitor lands before signing in
        'https://workspace.google.com/intl/de/products/voice/'
    ]) {
        assert.strictEqual(policy.isAppUrl(url), true, url);
        assert.strictEqual(policy.classify(url), 'app', url);
    }
});

test('look-alike hosts, other schemes, ports and embedded passwords are not the app', () => {
    for (const url of [
        'http://voice.google.com/',                              // not https
        'https://voice.google.com.example.com/',                 // suffix trick
        'https://example.com/voice.google.com',                  // path trick
        'https://example.com/?u=https://voice.google.com',       // query trick
        'https://voice.google.com@example.com/',                 // userinfo trick: the host is example.com
        'https://voice.google.com:evil@example.com/',
        'https://voice.google.com:444/',                         // unusual port
        'https://user:pw@voice.google.com/',                     // credentials
        'https://VOICE.GOOGLE.COM.evil.test/',
        'https://workspace.google.com.evil.test/products/voice/',
        'https://evil.test/workspace.google.com',
        'https://docs.google.com/',                              // other Google sites are not app hosts
        'https://myaccount.google.com/',                         // Google, but not an app host
        'https://www.google.com/accounts',
        'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'blob:https://voice.google.com/abc', 'about:blank',
        '', 'not a url', null, undefined, 42, {}
    ]) {
        assert.strictEqual(policy.isAppUrl(url), false, String(url));
    }
    assert.strictEqual(policy.isAppUrl('https://VOICE.google.com/u/0'), true);   // host names are case-insensitive
});

test('only the Voice page itself counts as the Voice page, and only /u/<n>/ is the signed-in app', () => {
    assert.strictEqual(policy.isVoiceUrl('https://voice.google.com/u/0/messages'), true);
    assert.strictEqual(policy.isVoiceUrl('https://accounts.google.com/'), false);
    assert.strictEqual(policy.isVoiceUrl('https://voice.google.com.evil.test/'), false);
    assert.strictEqual(policy.isSignedInVoiceUrl('https://voice.google.com/u/0/messages'), true);
    assert.strictEqual(policy.isSignedInVoiceUrl('https://voice.google.com/u/12'), true);
    assert.strictEqual(policy.isSignedInVoiceUrl('https://voice.google.com/about'), false);
    assert.strictEqual(policy.isSignedInVoiceUrl('https://voice.google.com/u/x/'), false);
    assert.strictEqual(policy.isSignedInVoiceUrl('https://accounts.google.com/u/0/'), false);
});

test('only web and mail links may be handed to the operating system', () => {
    assert.strictEqual(policy.externalUrl('https://github.com/lazyb5/GVoicePlus/releases'), 'https://github.com/lazyb5/GVoicePlus/releases');
    assert.strictEqual(policy.externalUrl('http://example.com/a b'), 'http://example.com/a%20b');
    assert.strictEqual(policy.externalUrl('mailto:someone@example.com?subject=Hi'), 'mailto:someone@example.com?subject=Hi');
    for (const url of [
        'file:///Applications/Calculator.app', 'file:///etc/hosts', 'smb://server/share', 'ms-msdt:/id PCWDiagnostic', 'ssh://host',
        'vscode://file/etc/passwd', 'x-apple.systempreferences:', 'tel:+15551234567', 'sms:+15551234567', 'facetime:x',
        'javascript:alert(1)', 'data:text/html;base64,AAAA', 'blob:https://voice.google.com/abc', 'about:blank', 'chrome://settings',
        'https://user:pw@example.com/', 'https:///nohost', 'https://', '',
        'https://example.com/\nsecond-line', 'https://exa\tmple.com/', 'https://example.com/\u0000',
        'https://example.com/' + 'a'.repeat(5000), null, undefined, 7
    ]) {
        assert.strictEqual(policy.externalUrl(url), null, String(url).slice(0, 60));
    }
});

test('classify sorts every address into app, external or block', () => {
    assert.strictEqual(policy.classify('https://voice.google.com/u/1/messages'), 'app');
    assert.strictEqual(policy.classify('https://support.google.com/voice'), 'external');
    assert.strictEqual(policy.classify('https://evil.example/phish'), 'external');   // the person's browser, not the app window
    assert.strictEqual(policy.classify('mailto:a@b.c'), 'external');
    assert.strictEqual(policy.classify('file:///etc/passwd'), 'block');
    assert.strictEqual(policy.classify('javascript:alert(1)'), 'block');
    assert.strictEqual(policy.classify('tel:+15551234567'), 'block');
});

const test = require('node:test');
const assert = require('node:assert');
const { SHOW_CLASS, CALLS_PATH, SOURCE } = require('../src/utils/dialerButton');
const { HIDE_DIALER_SIDEBAR_CSS } = require('../src/utils/cssInjector');

test('the Calls page path is recognised, other pages are not', () => {
    for (const p of ['/u/0/calls', '/u/1/calls/', '/calls']) { assert.ok(CALLS_PATH.test(p), p); }
    for (const p of ['/u/0/messages', '/u/0/callsx', '/u/0/voicemail', '/']) { assert.ok(!CALLS_PATH.test(p), p); }
});

test('the hide rule stands down when the show class is on <html>', () => {
    assert.ok(HIDE_DIALER_SIDEBAR_CSS.includes(`:not(.${SHOW_CLASS})`));
    assert.ok(HIDE_DIALER_SIDEBAR_CSS.includes('gv-call-sidebar'));
    assert.ok(HIDE_DIALER_SIDEBAR_CSS.includes('display: none'));
});

test('the page script is valid JavaScript and carries the pattern and class', () => {
    assert.doesNotThrow(() => new Function(SOURCE));
    assert.ok(SOURCE.includes(SHOW_CLASS));
});

test('the page script styles the button from the theme palette and sits inside the panel', () => {
    for (const key of ['primary', 'onPrimary', 'outline', '__gvDialerPalette']) { assert.ok(SOURCE.includes(key), key); }
    assert.ok(SOURCE.includes('right:28px') && SOURCE.includes('bottom:28px'));
});

test('the button is a dial pad icon with an accessible label and stays in the corner', () => {
    assert.ok(SOURCE.includes("createElementNS('http://www.w3.org/2000/svg', 'svg')"));
    assert.ok(SOURCE.includes('aria-pressed') && SOURCE.includes('Hide dialer'));
    assert.ok(!SOURCE.includes('textContent'));
    assert.ok(!SOURCE.includes("querySelector('gv-call-sidebar')") && !SOURCE.includes("'resize'"));
});

test('the dialer panel fades in when shown, and respects reduced motion', () => {
    assert.ok(HIDE_DIALER_SIDEBAR_CSS.includes(`html.${SHOW_CLASS} gv-call-sidebar`));
    assert.ok(HIDE_DIALER_SIDEBAR_CSS.includes('@keyframes gvp-dialer-in'));
    assert.ok(HIDE_DIALER_SIDEBAR_CSS.includes('prefers-reduced-motion'));
});

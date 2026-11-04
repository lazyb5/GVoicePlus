const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { MOTION_CSS } = require('../src/utils/cssInjector');

test('motion CSS is switched off for reduced motion and only animates cheap properties', () => {
    assert.ok(MOTION_CSS.includes('prefers-reduced-motion: no-preference'));
    const props = [...MOTION_CSS.matchAll(/transition:\s*([^;}]+)/g)].flatMap((m) => m[1].split(',').map((t) => t.trim().split(/\s+/)[0]));
    assert.ok(props.length > 0);
    for (const p of props) { assert.ok(['background-color', 'color', 'transform', 'filter', 'opacity'].includes(p), p); }
});

test('motion CSS covers the list rows, sidebar items and the dial pad button', () => {
    for (const sel of ['gv-thread-list-item .container', 'gv-side-nav a.navListItem', '.gvp-dialer-btn']) { assert.ok(MOTION_CSS.includes(sel), sel); }
});

test('the dial pad button carries the class the motion CSS targets', () => {
    const { SOURCE } = require('../src/utils/dialerButton');
    assert.ok(SOURCE.includes('gvp-dialer-btn'));
});

test('the Settings window animations are guarded by reduced motion', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'customize.css'), 'utf8');
    const block = css.slice(css.indexOf('prefers-reduced-motion'));
    assert.ok(block.includes('.tab-panel') && block.includes('.theme-swatch'));
});

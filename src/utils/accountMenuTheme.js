/**********************************************************************************************************************
 * Themes the profile-picture dropdown.  That menu is not part of Google Voice's own page: it is a separate embedded page
 * from Google's account service (https://ogs.google.com/u/N/widget/account), so the theme CSS injected into the main page
 * never reaches it, and it has no dark mode of its own.
 *
 * Google's class names in that page are scrambled and change over time, so nothing here relies on them.  Instead the page
 * is read by what it looks like: each element with a solid background is tagged by its original colour (outer card,
 * header strip, row tiles, icon discs) and each dark text by how dark it is, and a stylesheet recolours those tags from
 * the selected theme's palette (see themePalette.js).  A MutationObserver tags anything Google adds later.  Colours it
 * does not recognise fall back to the "row tile" colour, so a Google redesign degrades to a plain themed menu rather than
 * to an unreadable one.  Passing no palette (default theme) removes everything again.
 **********************************************************************************************************************/

// Runs INSIDE the embedded page (it is converted to text and sent there), so it must not refer to anything outside itself.
function frameMain(P) {
    const KEY = '__gvAccountTheme';
    if (window[KEY]) { window[KEY].stop(); }
    if (!P) { return 'removed'; }

    const parse = (s) => {
        const hex = /#([0-9a-f]{6})/i.exec(s || '');
        if (hex) { return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)); }
        const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s || '');
        return rgb ? [+rgb[1], +rgb[2], +rgb[3]] : [128, 128, 128];
    };
    const base = parse(P.surface || P.bg), fg = parse(P.fg), sub = parse(P.subtext || P.fg);
    const dark = P.scheme === 'dark';
    const mix = (t) => 'rgb(' + base.map((v, i) => Math.round(v * (1 - t) + fg[i] * t)).join(',') + ')';

    const style = document.createElement('style');
    style.id = 'gv-account-theme';
    style.textContent = [
        '[data-gv-role="card"] { background-color: ' + mix(0) + ' !important; }',
        '[data-gv-role="head"] { background-color: ' + mix(0.12) + ' !important; }',
        '[data-gv-role="tile"] { background-color: ' + mix(0.07) + ' !important; }',
        '[data-gv-role="tile"]:hover { background-color: ' + mix(0.14) + ' !important; }',
        '[data-gv-role="icon"] { background-color: ' + mix(0.16) + ' !important; }',
        // Rows that are transparent until the mouse is over them (so they were never tagged) would show Google's white.
        'a:hover, button:hover, [role="button"]:hover, [role="link"]:hover, [role="menuitem"]:hover { background-color: ' + mix(0.14) + ' !important; }',
        '[data-gv-fg="main"] { color: rgb(' + fg.join(',') + ') !important; }',
        '[data-gv-fg="sub"] { color: rgb(' + sub.join(',') + ') !important; }',
        'svg path { fill: rgb(' + fg.join(',') + ') !important; }',
        dark ? '[data-gv-small] { filter: invert(1) hue-rotate(180deg); }' : ''
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);

    // The colours Google's menu uses (light mode) and the part of the menu each one is.
    const ROLE = { '255,255,255': 'tile', '240,244,249': 'card', '221,227,234': 'head', '233,238,246': 'icon' };
    const channels = (c) => { const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(c); return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null; };

    let count = 0;
    const tagAll = () => {
        document.querySelectorAll('*').forEach((el) => {
            if (!el.hasAttribute('data-gv-role')) {
                const bg = channels(getComputedStyle(el).backgroundColor);
                if (bg && bg.a > 0.05) { el.setAttribute('data-gv-role', ROLE[bg.rgb.join(',')] || 'tile'); count++; }
            }
            if (!el.hasAttribute('data-gv-fg') && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
                const c = channels(getComputedStyle(el).color);
                if (c && Math.max(...c.rgb) - Math.min(...c.rgb) < 24) {     // neutral grey text only (links keep their colour)
                    const avg = (c.rgb[0] + c.rgb[1] + c.rgb[2]) / 3;
                    if (avg < 110) { el.setAttribute('data-gv-fg', avg <= 55 ? 'main' : 'sub'); count++; }
                }
            }
            if (dark && el.tagName === 'IMG' && !el.hasAttribute('data-gv-small') && el.getBoundingClientRect().width <= 32) {
                el.setAttribute('data-gv-small', '1');
            }
        });
    };
    let timer = null;
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(tagAll, 80); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    tagAll();

    window[KEY] = {
        stop: () => {
            observer.disconnect();
            clearTimeout(timer);
            style.remove();
            document.querySelectorAll('[data-gv-role],[data-gv-fg],[data-gv-small]').forEach((el) => {
                el.removeAttribute('data-gv-role'); el.removeAttribute('data-gv-fg'); el.removeAttribute('data-gv-small');
            });
            delete window[KEY];
        }
    };
    return 'themed ' + count + ' parts';
}

// The text of the script to run inside the menu's page for this palette (null = remove the theme).
function buildScript(palette) {
    return '(' + frameMain.toString() + ')(' + JSON.stringify(palette || null) + ')';
}

// Applies (or, with a null palette, removes) the theme in every profile-menu page of the main window.  Only dark themes
// are applied: Google's menu is already light, which fits the light themes as it is.
function apply(win, palette) {
    try {
        if (!win || win.isDestroyed()) { return; }
        const script = buildScript(palette && palette.scheme === 'dark' ? palette : null);
        for (const frame of win.webContents.mainFrame.framesInSubtree) {
            if (/^https:\/\/ogs\.google\.com\/u\/\d+\/widget\/account/.test(frame.url)) {
                frame.executeJavaScript(script).catch(() => { /* frame went away */ });
            }
        }
    } catch (e) { console.log('Profile menu theme failed:', e.message); }
}

module.exports = { apply, buildScript };

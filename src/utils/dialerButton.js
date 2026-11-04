// "Dialer" button on the Calls page, for people who turned on "Hide dialer sidebar".
// The button only toggles a class on <html>; the hide rule (cssInjector.js) is written to stand down when that class is
// present, so Google's own styling decides how the dialer looks. No IPC, no new permission, and it never touches drafts.
const SHOW_CLASS = 'gvp-show-dialer';
const CALLS_PATH = /\/calls\/?$/;

// Runs INSIDE the Google Voice page (stringified), so it must be fully self-contained.
function pageDialerButton(pattern, showClass) {
    if (window.__gvDialerButton) { window.__gvDialerButton.refresh(); return; }
    const callsPath = new RegExp(pattern);
    const root = document.documentElement;
    let button = null;
    const label = () => {
        if (!button) { return; }
        const open = root.classList.contains(showClass);
        button.title = button.ariaLabel = open ? 'Hide dialer' : 'Dialer';
        button.setAttribute('aria-pressed', open ? 'true' : 'false');
    };
    // Colours come from the selected theme's palette (set by setPalette); no palette = the plain blue default.
    const paint = () => {
        if (!button) { return; }
        const p = window.__gvDialerPalette;
        const ok = (c) => typeof c === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.]+\)|white|black)$/i.test(c);
        const bg = p && ok(p.primary) ? p.primary : '#1a73e8';
        const fg = p && ok(p.onPrimary) ? p.onPrimary : '#ffffff';
        const line = p && ok(p.outline) ? p.outline : 'transparent';
        button.style.background = bg;
        button.style.color = fg;
        button.style.border = '1px solid ' + line;
        button.style.boxShadow = '0 1px 4px rgba(0,0,0,.25)';
    };
    const ensureButton = () => {
        if (button && button.isConnected) { return button; }
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'gvp-dialer-btn';   // hover/press animation lives in cssInjector.js (MOTION_CSS)
        button.style.cssText = 'position:fixed;right:28px;bottom:28px;z-index:2147483000;width:48px;height:48px;padding:0;' +
            'border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');   // 3x3 dial pad dots, coloured by the text colour
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
        svg.setAttribute('aria-hidden', 'true'); svg.style.fill = 'currentColor';
        [5, 12, 19].forEach((y) => [5, 12, 19].forEach((x) => {
            const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 2);
            svg.appendChild(c);
        }));
        button.appendChild(svg);
        paint();
        button.addEventListener('click', () => { root.classList.toggle(showClass); label(); });
        document.body.appendChild(button);
        return button;
    };
    const refresh = () => {
        const show = window.__gvDialerHidden === true && callsPath.test(location.pathname);
        if (!show) { root.classList.remove(showClass); }   // leaving Calls (or the setting off) hides it again
        if (show) { ensureButton().style.display = ''; label(); }
        else if (button) { button.style.display = 'none'; }
    };
    ['pushState', 'replaceState'].forEach((m) => {   // Google Voice changes pages without reloading
        const orig = history[m];
        history[m] = function () { const r = orig.apply(this, arguments); setTimeout(refresh, 0); return r; };
    });
    window.addEventListener('popstate', refresh);
    window.__gvDialerButton = { refresh, paint };
    refresh();
}

const SOURCE = `(${pageDialerButton.toString()})(${JSON.stringify(CALLS_PATH.source)}, ${JSON.stringify(SHOW_CLASS)});`;

// Tells the page whether "Hide dialer sidebar" is on (the button only exists while it is).
function setHidden(win, hidden) {
    if (!win || win.isDestroyed()) { return; }
    win.webContents.executeJavaScript(
        `window.__gvDialerHidden = ${hidden ? 'true' : 'false'}; window.__gvDialerButton && window.__gvDialerButton.refresh();`
    ).catch(() => {});
}

// Gives the page the selected theme's colours (null = default blue) and restyles the button at once.
function setPalette(win, palette) {
    if (!win || win.isDestroyed()) { return; }
    const p = palette ? { primary: palette.primary, onPrimary: palette.onPrimary, outline: palette.outline } : null;
    win.webContents.executeJavaScript(
        `window.__gvDialerPalette = ${JSON.stringify(p)}; window.__gvDialerButton && window.__gvDialerButton.paint();`
    ).catch(() => {});
}

// Installs the button in the main window (safe to call on every page load).
function start(win) {
    if (!win || win.isDestroyed()) { return; }
    win.webContents.executeJavaScript(SOURCE).catch(() => {});
}

module.exports = { SHOW_CLASS, CALLS_PATH, SOURCE, setHidden, setPalette, start };

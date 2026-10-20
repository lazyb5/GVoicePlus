/**********************************************************************************************************************
 * Hides the items of Google Voice's top bar (menu, logo, search, "Receiving calls", Upgrade, audio/help/settings
 * buttons, apps, account) that the user has switched off in Settings.  The choice is a list of item keys that the main
 * process stores; it is applied on every page load and re-applied whenever Google redraws the bar.
 *
 * Items are found by labels and component names rather than Google's obfuscated "gb_xxx" classes, which change.  An
 * item that isn't on the page (e.g. Upgrade on some accounts) is simply skipped.
 **********************************************************************************************************************/

// Runs INSIDE the Google Voice page (stringified and executed there), so it must be fully self-contained.
function pageTopBar() {
    if (window.__gvTopBar) { return; }

    const q = (selector) => Array.from(document.querySelectorAll(selector));
    const ITEMS = [
        { key: 'menu',     label: 'Menu',            find: () => q('[aria-label="Main menu"]') },
        { key: 'logo',     label: 'Voice logo',      find: () => q('a[aria-label="Google Voice"]') },
        { key: 'search',   label: 'Search',          find: () => q('input[aria-label="Search"]').map((i) => i.closest('form')).filter(Boolean) },
        { key: 'status',   label: 'Receiving calls', find: () => q('gv-availability-chip') },
        { key: 'upgrade',  label: 'Upgrade',         find: () => q('.upgrade-link') },
        { key: 'audio',    label: 'Audio settings',  find: () => q('gv-ogb-audio-button') },
        { key: 'help',     label: 'Help',            find: () => q('gv-ogb-help-button') },
        { key: 'settings', label: 'Settings',        find: () => q('gv-ogb-settings-button') },
        { key: 'apps',     label: 'Google apps',     find: () => q('a[aria-label="Google apps"]') },
        { key: 'account',  label: 'Account',         find: () => q('a[aria-label^="Google Account"]') }
    ];
    const HIDDEN = 'data-gv-topbar-hidden';   // on an element we hid; value = its previous inline display

    let hiddenKeys = new Set();
    let observer = null;
    let timer = null;

    const unhide = (el) => {
        if (el.hasAttribute(HIDDEN)) {
            const prev = el.getAttribute(HIDDEN);
            if (prev) { el.style.setProperty('display', prev); } else { el.style.removeProperty('display'); }
            el.removeAttribute(HIDDEN);
        }
    };
    // Hide the chosen items (and show any that are no longer chosen).
    const applyHidden = (keys) => {
        ITEMS.forEach((item) => item.find().forEach((el) => {
            if (keys.has(item.key)) {
                if (!el.hasAttribute(HIDDEN)) { el.setAttribute(HIDDEN, el.style.display || ''); }
                el.style.setProperty('display', 'none', 'important');
            } else {
                unhide(el);
            }
        }));
    };

    // Watch only the top bar (not the whole page), and only re-apply when it is redrawn.
    let watching = false;
    const watch = () => {
        if (watching) { return; }
        watching = true;
        const attach = (target) => {
            observer = new MutationObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(() => { applyHidden(hiddenKeys); }, 200);
            });
            observer.observe(target, { childList: true, subtree: true });
        };
        const bar = () => document.querySelector('.gv-page > div');
        if (bar()) { attach(bar()); return; }
        let tries = 0;   // the bar appears a moment after the app starts
        const wait = setInterval(() => {
            const found = bar();
            if (found || ++tries > 40) { clearInterval(wait); attach(found || document.body); applyHidden(hiddenKeys); }
        }, 500);
    };

    window.__gvTopBar = {
        set(keys) { hiddenKeys = new Set(keys); applyHidden(hiddenKeys); watch(); },
        // Which items exist on the page right now (an item we hid is still there).
        present() { return ITEMS.filter((item) => item.find().length > 0).map((item) => item.key); }
    };
}

const SOURCE = `(${pageTopBar.toString()})();`;
module.exports.SOURCE = SOURCE;   // exported for testing

// Hides the given item keys in the main window (and keeps them hidden).
module.exports.apply = function (win, keys) {
    if (!win || win.isDestroyed()) { return; }
    win.webContents.executeJavaScript(`${SOURCE} window.__gvTopBar.set(${JSON.stringify(keys || [])});`).catch(() => {});
};

// Which item keys exist on the main window's page, or null if that can't be told (page not loaded, or the bar not drawn yet).
module.exports.present = function (win) {
    if (!win || win.isDestroyed()) { return Promise.resolve(null); }
    return win.webContents.executeJavaScript(`${SOURCE} (window.__gvTopBar.present ? window.__gvTopBar.present() : null);`)
        .then((keys) => (Array.isArray(keys) && keys.length >= 3 ? keys : null))   // fewer than 3 = the bar isn't there yet (e.g. signed out)
        .catch(() => null);
};

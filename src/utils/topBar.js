/**********************************************************************************************************************
 * Lets the user choose which items of Google Voice's top bar are shown (menu, logo, search, "Receiving calls",
 * Upgrade, audio/help/settings buttons, apps, account).  In "edit mode" every item gets an outline over it; clicking an
 * item hides or shows it, and a small panel offers Done / Cancel / Reset.  The choice is a list of item keys that the
 * main process stores; it is applied on every page load and re-applied whenever Google redraws the bar.
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
    const GHOST = 'data-gv-topbar-ghost';     // on a hidden element shown dimmed while editing; value = previous opacity

    let hiddenKeys = new Set();
    let editing = false;
    let observer = null;
    let timer = null;

    const unhide = (el) => {
        if (el.hasAttribute(HIDDEN)) {
            const prev = el.getAttribute(HIDDEN);
            if (prev) { el.style.setProperty('display', prev); } else { el.style.removeProperty('display'); }
            el.removeAttribute(HIDDEN);
        }
    };
    const unghost = (el) => {
        if (el.hasAttribute(GHOST)) {
            const prev = el.getAttribute(GHOST);
            if (prev) { el.style.setProperty('opacity', prev); } else { el.style.removeProperty('opacity'); }
            el.removeAttribute(GHOST);
        }
    };

    // Hide the chosen items (or, while editing, show them dimmed so they can still be clicked and restored).
    const applyHidden = (keys) => {
        ITEMS.forEach((item) => item.find().forEach((el) => {
            const wanted = keys.has(item.key);
            if (wanted && !editing) {
                unghost(el);
                if (!el.hasAttribute(HIDDEN)) { el.setAttribute(HIDDEN, el.style.display || ''); }
                el.style.setProperty('display', 'none', 'important');
            } else if (wanted && editing) {
                unhide(el);
                if (!el.hasAttribute(GHOST)) { el.setAttribute(GHOST, el.style.opacity || ''); }
                el.style.setProperty('opacity', '0.25', 'important');
            } else {
                unhide(el);
                unghost(el);
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
                timer = setTimeout(() => { if (!editing) { applyHidden(hiddenKeys); } }, 200);
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

    const edit = (startKeys) => new Promise((resolve) => {
        if (document.getElementById('gv-topbar-edit')) { resolve({ status: 'busy' }); return; }
        const original = new Set(startKeys);
        const working = new Set(startKeys);
        editing = true;
        applyHidden(working);

        const layer = document.createElement('div');
        layer.id = 'gv-topbar-edit';
        layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
        document.body.appendChild(layer);

        const status = document.createElement('span');
        const panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);display:flex;gap:12px;align-items:center;' +
            'padding:10px 14px;border-radius:18px;background:#202124;color:#fff;font:14px system-ui,sans-serif;' +
            'box-shadow:0 4px 18px rgba(0,0,0,.5);pointer-events:auto;';
        const hint = 'Click an item in the top bar to hide or show it';
        status.textContent = hint;
        status.style.cssText = 'min-width:260px;';
        panel.appendChild(status);
        const button = (text, primary, onClick) => {
            const b = document.createElement('button');
            b.textContent = text;
            b.style.cssText = 'border:0;border-radius:12px;padding:6px 14px;font:inherit;cursor:pointer;' +
                (primary ? 'background:#8ab4f8;color:#202124;' : 'background:#3c4043;color:#fff;');
            b.addEventListener('click', onClick);
            panel.appendChild(b);
            return b;
        };

        const chips = [];
        const paint = () => chips.forEach(({ chip, key }) => {
            const off = working.has(key);
            chip.style.border = off ? '2px dashed rgba(255,95,95,.95)' : '2px solid rgba(255,255,255,.85)';
            chip.style.background = off ? 'rgba(255,70,70,.14)' : 'rgba(255,255,255,.08)';
        });
        const place = () => chips.forEach(({ chip, el }) => {
            const r = el.getBoundingClientRect();
            chip.style.left = (r.left - 3) + 'px';
            chip.style.top = (r.top - 3) + 'px';
            chip.style.width = (r.width + 6) + 'px';
            chip.style.height = (r.height + 6) + 'px';
        });
        ITEMS.forEach((item) => item.find().forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) { return; }
            if (r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0 || r.top >= window.innerHeight) { return; }   // off-screen copies
            const chip = document.createElement('div');
            chip.style.cssText = 'position:fixed;box-sizing:border-box;border-radius:12px;cursor:pointer;pointer-events:auto;';
            chip.title = item.label;
            chip.addEventListener('mouseenter', () => { status.textContent = item.label + (working.has(item.key) ? ' (hidden) - click to show' : ' - click to hide'); });
            chip.addEventListener('mouseleave', () => { status.textContent = hint; });
            chip.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (working.has(item.key)) { working.delete(item.key); } else { working.add(item.key); }
                applyHidden(working);
                paint();
                status.textContent = item.label + (working.has(item.key) ? ' (hidden) - click to show' : ' - click to hide');
            });
            layer.appendChild(chip);
            chips.push({ chip, el, key: item.key });
        }));
        place();
        paint();

        const finish = (result) => {
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', place);
            layer.remove();
            panel.remove();
            editing = false;
            hiddenKeys = new Set(result.status === 'done' ? working : original);
            applyHidden(hiddenKeys);
            watch();
            resolve({ status: result.status, hidden: Array.from(hiddenKeys) });
        };
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish({ status: 'cancel' }); } };
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', place);

        button('Reset', false, () => { working.clear(); applyHidden(working); paint(); });
        button('Cancel', false, () => finish({ status: 'cancel' }));
        button('Done', true, () => finish({ status: 'done' }));
        document.body.appendChild(panel);
    });

    window.__gvTopBar = {
        set(keys) { hiddenKeys = new Set(keys); if (!editing) { applyHidden(hiddenKeys); } watch(); },
        // Which items exist on the page right now (an item we hid is still there).
        present() { return ITEMS.filter((item) => item.find().length > 0).map((item) => item.key); },
        edit
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

// Enters edit mode in the main window.  Resolves with { status: 'done' | 'cancel' | 'busy', hidden: [keys] }.
module.exports.edit = function (win, keys) {
    if (!win || win.isDestroyed()) { return Promise.resolve({ status: 'cancel', hidden: keys || [] }); }
    return win.webContents.executeJavaScript(`${SOURCE} window.__gvTopBar.edit(${JSON.stringify(keys || [])});`)
        .catch(() => ({ status: 'cancel', hidden: keys || [] }));
};

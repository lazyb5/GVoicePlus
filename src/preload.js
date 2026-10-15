/**********************************************************************************************************************
 * Preload script for the main application window.  Contains all code
 * that needs to execute before the window's web content begins loading.
 **********************************************************************************************************************/

// Apply the theme before the page's first paint, so Google's white header never shows.  The main process hands back
// the theme CSS (or nothing for pages that should stay unthemed); main.js removes this <style> once its own copy of
// the theme is in place, so switching themes later works normally.
(() => {
    try {
        const {ipcRenderer} = require('electron');
        const css = ipcRenderer.sendSync('get-early-theme-css', window.location.href);
        if (!css) { return; }
        const style = document.createElement('style');
        style.id = 'gv-early-theme';
        style.textContent = css;
        const attach = () => {
            const host = document.head || document.documentElement;
            if (host) { host.appendChild(style); }
            return style.isConnected;
        };
        if (!attach()) {
            const observer = new MutationObserver(() => { if (attach()) { observer.disconnect(); } });
            observer.observe(document, {childList: true, subtree: true});
        }
    } catch (e) { /* never let theming break the page */ }
})();

// "Collapse sidebar" (src/utils/sideNav.js): Google picks its narrow-window layout, where the sidebar is hidden and the
// hamburger floats it over the page, from a couple of window-width checks.  While window.__gvForceNarrow is true those
// checks answer "narrow", at any window width.  Every other query passes through untouched.
(() => {
    try {
        const {ipcRenderer} = require('electron');
        const FORCED = new Set(['(max-width: 999.99px)', '(max-width: 1019.99px)']);
        const original = window.matchMedia.bind(window);
        const refreshers = new Set();
        const navPrefs = ipcRenderer.sendSync('get-collapse-side-nav') || {};
        window.__gvForceNarrow = !!navPrefs.collapse;
        window.__gvHoverNav = !!navPrefs.hover;
        window.__gvSetForceNarrow = (on) => { window.__gvForceNarrow = !!on; refreshers.forEach((f) => f()); };

        window.matchMedia = (query) => {
            const real = original(query);
            if (!FORCED.has(query)) { return real; }

            // A stand-in for the real MediaQueryList whose answer can be overridden, and which tells listeners when it changes.
            const listeners = new Set();
            const answer = () => window.__gvForceNarrow ? true : real.matches;
            let last = answer();
            const stand = {
                media: query,
                get matches() { return answer(); },
                onchange: null,
                addListener: (fn) => listeners.add(fn),
                removeListener: (fn) => listeners.delete(fn),
                addEventListener: (type, fn) => { if (type === 'change') { listeners.add(fn); } },
                removeEventListener: (type, fn) => listeners.delete(fn),
                dispatchEvent: () => true
            };
            const refresh = () => {
                const now = answer();
                if (now === last) { return; }
                last = now;
                const event = {matches: now, media: query, type: 'change'};
                listeners.forEach((fn) => fn.call(stand, event));
                if (typeof stand.onchange === 'function') { stand.onchange(event); }
            };
            refreshers.add(refresh);
            if (real.addEventListener) { real.addEventListener('change', refresh); } else { real.addListener(refresh); }
            return stand;
        };
    } catch (e) { /* never let this break the page */ }
})();

// "Show sidebar on hover" (only while the sidebar is collapsed): touching the hamburger button or the far-left edge of the
// page opens the sidebar by pressing the hamburger for you, and moving the mouse away closes it again the same way.
(() => {
    try {
        const OPEN_CLASS = 'mat-drawer-opened';
        const EDGE = 6;            // width in px of the invisible hot zone along the left edge
        const CLOSE_DELAY = 350;   // ms the mouse must stay away before the sidebar closes
        const COOLDOWN = 700;      // ms after pressing the hamburger during which nothing is pressed again (animation)
        let closeTimer = null;
        let lastToggle = 0;

        const hamburger = () => Array.from(document.querySelectorAll('[aria-label]'))
            .find((el) => /^main menu$/i.test((el.getAttribute('aria-label') || '').trim()));
        const drawer = () => document.querySelector('mat-sidenav');
        const isOpen = () => { const d = drawer(); return !!d && d.classList.contains(OPEN_CLASS); };
        const toggle = () => { const h = hamburger(); if (h && Date.now() - lastToggle > COOLDOWN) { lastToggle = Date.now(); h.click(); } };
        const active = () => window.__gvForceNarrow && window.__gvHoverNav;
        const cancelClose = () => { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } };
        const scheduleClose = () => {
            if (closeTimer) { return; }
            closeTimer = setTimeout(() => { closeTimer = null; if (active() && isOpen()) { toggle(); } }, CLOSE_DELAY);
        };

        document.addEventListener('mousemove', (e) => {
            if (!active()) { return; }
            const h = hamburger();
            const d = drawer();
            const overHamburger = !!h && h.contains(e.target);
            const overEdge = e.clientX <= EDGE && e.clientY > 65;
            const overDrawer = !!d && d.contains(e.target);
            if (overHamburger || overEdge) {
                cancelClose();
                if (!isOpen()) { toggle(); }
            } else if (overDrawer) {
                cancelClose();
            } else if (isOpen()) {
                scheduleClose();
            }
        }, {passive: true});

        // Mouse left the window altogether.
        document.addEventListener('mouseleave', () => { if (active() && isOpen()) { scheduleClose(); } });
    } catch (e) { /* never let this break the page */ }
})();

(async() => {
    // Get this application's execution path.
    const {ipcRenderer} = require('electron');

    // Lets the page-side unread watcher (src/utils/unreadWatcher.js) report the count the moment it changes.
    window.__gvUnread = (count) => ipcRenderer.send('gv-unread', count);

    const appPath = await ipcRenderer.invoke('get-appPath');

    // Modify JavaScript's "Notification" class such that all notifications that get generated will have a
    // click handler attached to them which fires a "notification-clicked" event back at the main process.
    const {notificationShim} = require('./utils/notificationShim');
    notificationShim(appPath);
})();
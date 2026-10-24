
/**********************************************************************************************************************
 * Preload script for the main application window.  Contains all code
 * that needs to execute before the window's web content begins loading.
 *
 * Google's page runs with Node switched off and context isolation on, so it cannot reach Node or Electron.  This file
 * runs in its own isolated world and is the only code here that can talk to the main process.  The page gets just three
 * small hooks (window.__gvBridge for notifications, window.__gvUnread for the badge count), made with contextBridge,
 * and the few things that must run inside the page itself (the sidebar tweaks and the Notification stand-in) are injected
 * into the page's own world with webFrame.executeJavaScript.
 **********************************************************************************************************************/

const {ipcRenderer, contextBridge, webFrame} = require('electron');
const {notificationShim} = require('./utils/notificationShim');

// Apply the theme before the page's first paint, so Google's white header never shows.  The main process hands back
// the theme CSS (or nothing for pages that should stay unthemed); main.js removes this <style> once its own copy of
// the theme is in place, so switching themes later works normally.  Only touches the DOM, which both worlds share.
(() => {
    try {
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

// The only doors from the page to the app.  Everything is coerced to plain values here, so the page cannot hand the
// main process anything unexpected.
let notifyClickCallback = null;
const short = (value, max) => String(value == null ? '' : value).slice(0, max);

contextBridge.exposeInMainWorld('__gvBridge', {
    notify: (data) => {
        const d = data || {};
        ipcRenderer.send('gv-notify', {
            id: Number(d.id) || 0,
            title: short(d.title, 500),
            body: short(d.body, 5000),
            tag: short(d.tag, 500),
            silent: !!d.silent
        });
    },
    close: (id) => { ipcRenderer.send('gv-notify-close', Number(id) || 0); },
    onClick: (callback) => { if (typeof callback === 'function') { notifyClickCallback = callback; } }
});

// Lets the page-side unread watcher (src/utils/unreadWatcher.js) report the count the moment it changes.
contextBridge.exposeInMainWorld('__gvUnread', (count) => { ipcRenderer.send('gv-unread', Number(count) || 0); });

// The main process tells us when the user clicked a notification: pass it to the page's stand-in, then send the
// existing "notification-clicked" event back, as before.
ipcRenderer.on('gv-notify-click', (_event, id) => {
    try { if (notifyClickCallback) { notifyClickCallback(id); } } catch (e) { /* ignore */ }
    ipcRenderer.send('notification-clicked', {});
});

// Runs `fn` (a self-contained function) inside the page's own world.
const runInPage = (source) => { webFrame.executeJavaScript(source).catch(() => { /* never let this break the page */ }); };

// The sidebar tweaks.  This function is injected into the page's own world (see the bottom of this file), so it must be
// self-contained and use only the page's window and document.  It keeps the window.__gv... names the main process
// scripts (src/utils/sideNav.js) already use.
function pageSideNav(navPrefs) {
    // "Collapse sidebar" (src/utils/sideNav.js): Google picks its narrow-window layout, where the sidebar is hidden and the
    // hamburger floats it over the page, from a couple of window-width checks.  While window.__gvForceNarrow is true those
    // checks answer "narrow", at any window width.  Every other query passes through untouched.
    (() => {
        try {
            const FORCED = new Set(['(max-width: 999.99px)', '(max-width: 1019.99px)']);
            const original = window.matchMedia.bind(window);
            const refreshers = new Set();
            window.__gvForceNarrow = !!navPrefs.collapse;
            window.__gvHoverNav = !!navPrefs.hover;

            // While collapsed, Google's floating sidebar panel is 360px wide but its menu is only 240px, so 120px of empty panel
            // sticks out over the page.  Trim the panel to the menu's width.
            const navStyle = document.createElement('style');
            const syncNavStyle = () => { navStyle.textContent = window.__gvForceNarrow ? 'mat-sidenav.mat-drawer { width: 240px !important; }' : ''; };
            const attachNavStyle = () => { if (!navStyle.isConnected) { const host = document.documentElement || document.head; if (host) { host.appendChild(navStyle); } } };
            syncNavStyle();
            attachNavStyle();
            document.addEventListener('readystatechange', attachNavStyle);
            document.addEventListener('DOMContentLoaded', attachNavStyle);

            window.__gvSetForceNarrow = (on) => { window.__gvForceNarrow = !!on; syncNavStyle(); refreshers.forEach((f) => f()); };

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

    // While the sidebar is collapsed, Google's floating sidebar moves keyboard focus to its first item ("Calls") each time it
    // opens, which paints a grey highlight on it.  Undo that unless the person really focused something there: a click inside
    // the sidebar, or a recent key press (Tab / arrow keys), is left alone.
    (() => {
        try {
            let lastKey = 0;
            let pointerInDrawer = false;
            document.addEventListener('keydown', () => { lastKey = Date.now(); }, true);
            document.addEventListener('pointerdown', (e) => {
                const d = document.querySelector('mat-sidenav');
                pointerInDrawer = !!d && d.contains(e.target);
            }, true);
            document.addEventListener('focusin', (e) => {
                if (!window.__gvForceNarrow || pointerInDrawer || Date.now() - lastKey < 1500) { return; }
                const d = document.querySelector('mat-sidenav');
                if (d && d.contains(e.target) && typeof e.target.blur === 'function') { e.target.blur(); }
            }, true);
        } catch (e) { /* never let this break the page */ }
    })();
}

// Put both page-side pieces into the page's own world.  They are plain text by the time they get there, so nothing from
// this (Node-enabled) world leaks across.
let navPrefs = {};
try { navPrefs = ipcRenderer.sendSync('get-collapse-side-nav') || {}; } catch (e) { /* default: not collapsed */ }
runInPage(`(${pageSideNav.toString()})(${JSON.stringify({collapse: !!navPrefs.collapse, hover: !!navPrefs.hover})});`);

// Modify JavaScript's "Notification" class such that all notifications that get generated are forwarded to the main
// process through the bridge above, and clicks come back the same way.
runInPage(`(${notificationShim.toString()})(window.__gvBridge);`);

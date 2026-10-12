/**********************************************************************************************************************
 * Reports the unread count to the main process the moment it changes, instead of the main process asking the page
 * every few seconds.  A small observer watches only the side navigation's labels (and the tab title), so it does
 * nothing while nothing changes.  The main process keeps a slow poll (see updateNotifications) as a safety net.
 **********************************************************************************************************************/

// Runs INSIDE the Google Voice page (stringified and executed there), so it must be fully self-contained.
// Current Google Voice puts the unread count in each nav item's label (e.g. "Messages: 2 unread"); only the items above
// the divider count (Calls, Messages, Voicemail; not Spam/Archive).  Returns null while the page isn't ready.
function countUnread() {
    if (!document.querySelector('gv-side-nav')) { return null; }
    const seen = new Set();
    let total = 0;
    let found = false;
    document.querySelectorAll('gv-side-nav a.navListItem:not(.menuDivider~.navListItem)').forEach((a) => {
        const label = a.getAttribute('aria-label') || '';
        const name = label.split(':')[0].trim().toLowerCase();
        if (seen.has(name)) { return; }   // the nav is drawn twice (icon rail and expanded drawer)
        seen.add(name);
        const m = label.match(/(\d+)\s*unread/i);
        if (m) { total += parseInt(m[1], 10); found = true; }
    });
    if (!found) {   // older markup: numbers in badge elements
        document.querySelectorAll('.mat-sidenav-content .navListItem:not(.menuDivider~.navListItem) .navItemBadge').forEach((n) => {
            const v = parseInt((n.textContent || '').trim(), 10);
            if (Number.isFinite(v)) { total += v; }
        });
    }
    return total;
}

// Also runs in the page.
function pageWatcher(count) {
    if (window.__gvUnreadWatcher) { window.__gvUnreadWatcher.push(); return; }
    let last = null;
    let timer = null;
    let navObserver = null;
    let navTarget = null;
    let tries = 0;

    const watchNav = () => {
        const nav = document.querySelector('gv-side-nav');
        if (!nav) { return false; }
        if (navObserver) { navObserver.disconnect(); }
        navTarget = nav;
        navObserver = new MutationObserver(() => schedule());
        navObserver.observe(nav, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
        return true;
    };
    const push = () => {
        if (navTarget && !navTarget.isConnected) { watchNav(); }   // Angular replaced the nav: watch the new one
        const n = count();
        if (n === null || n === last) { return; }
        last = n;
        if (window.__gvUnread) { window.__gvUnread(n); }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(push, 300); };

    const title = document.querySelector('title');
    if (title) { new MutationObserver(schedule).observe(title, { childList: true, subtree: true, characterData: true }); }

    // The nav appears a moment after Google's app starts; look for it twice a second, for at most a minute.
    const boot = setInterval(() => {
        if (watchNav() || ++tries > 120) { clearInterval(boot); push(); }
    }, 500);

    window.__gvUnreadWatcher = { push };
}

module.exports.COUNT_EXPR = `(${countUnread.toString()})()`;
const WATCHER_SOURCE = `(${pageWatcher.toString()})(${countUnread.toString()});`;
module.exports.WATCHER_SOURCE = WATCHER_SOURCE;   // exported for testing

// Starts watching in the main window (safe to call on every page load).
module.exports.start = function (win) {
    if (!win || win.isDestroyed()) { return; }
    win.webContents.executeJavaScript(WATCHER_SOURCE).catch(() => {});
};

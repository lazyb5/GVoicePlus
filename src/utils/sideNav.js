/**********************************************************************************************************************
 * "Collapse sidebar": makes Google Voice use its narrow-window layout for the left navigation at any window width, so
 * the sidebar stays hidden and the hamburger button floats it over the page (and it hides again afterwards).
 *
 * Google picks that layout from a couple of window-width checks (window.matchMedia).  preload.js wraps those checks;
 * while "force narrow" is on they answer "yes, narrow".  The preload script sets the initial state when a page loads,
 * and setCollapsed() changes it on the fly (no reload needed, so no unsent draft is ever lost).
 **********************************************************************************************************************/

function setCollapsed(win, collapsed) {
    if (!win || win.isDestroyed()) { return Promise.resolve('no-window'); }
    const flip = `(function (on) {
        if (!window.__gvSetForceNarrow) { return 'shim-missing'; }
        window.__gvSetForceNarrow(on);
        return 'set';
    })(${collapsed ? 'true' : 'false'})`;
    return win.webContents.executeJavaScript(flip)
        .then((result) => { console.log(`Sidebar ${collapsed ? 'collapse' : 'restore'}: ${result}`); return result; })
        .catch((e) => { console.log('Sidebar change failed:', e); return 'error'; });
}

// Turns "show the sidebar when hovering the hamburger / left edge" on or off (see preload.js).
function setHover(win, on) {
    if (!win || win.isDestroyed()) { return; }
    win.webContents.executeJavaScript(`window.__gvHoverNav = ${on ? 'true' : 'false'}`).catch(() => {});
}

module.exports = { setCollapsed, setHover };

/**********************************************************************************************************************
 * Preload script for the title bar strip (Windows and Linux, src/pages/titlebar.html).
 *
 * The strip runs sandboxed with Node off and context isolation on.  It gets window.gvTitleBar with three methods: open
 * one of the four menus, hear about new theme colours, hear that the menu closed.  The main process checks who is
 * asking and which menu (main.js).
 **********************************************************************************************************************/

const {contextBridge, ipcRenderer} = require('electron');

const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null);

contextBridge.exposeInMainWorld('gvTitleBar', {
    // Opens menu number `index` (0-3) as a native popup at (x, y) in window coordinates.
    openMenu: (index, x, y) => {
        if (Number.isInteger(index) && index >= 0 && index < 8 && Number.isFinite(x) && Number.isFinite(y)) {
            ipcRenderer.send('titlebar-menu', index, x, y);
        }
    },
    onColours: (callback) => {
        if (typeof callback !== 'function') { return; }
        ipcRenderer.on('titlebar-colours', (_event, c) => {
            callback(c && typeof c === 'object' ? {bg: hex(c.bg), fg: hex(c.fg), hover: hex(c.hover)} : null);
        });
    },
    onMenuClosed: (callback) => {
        if (typeof callback === 'function') { ipcRenderer.on('titlebar-menu-closed', () => callback()); }
    }
});

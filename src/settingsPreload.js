/**********************************************************************************************************************
 * Preload script for the Settings window (src/pages/customize.html).
 *
 * The Settings page runs sandboxed with Node off and context isolation on.  It gets one object, window.gvSettings, with
 * one named method per thing the page needs: read this value, change that setting.  There is no generic "send any
 * message" or "call any channel" method.  Each method checks the type of its argument here and the main process checks
 * it again, together with who sent it (main.js, "Settings window messages").
 **********************************************************************************************************************/

const {contextBridge, ipcRenderer} = require('electron');

const THEME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const isBool = (v) => typeof v === 'boolean';
const isTheme = (v) => typeof v === 'string' && THEME_ID.test(v);
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isKeyList = (v) => Array.isArray(v) && v.length <= 32 && v.every((k) => typeof k === 'string' && k.length <= 32);

// Messages without an answer.  A bad argument is dropped here instead of being sent.
const send = (channel, valid) => (value) => { if (valid(value)) { ipcRenderer.send(channel, value); } };
// Questions with an answer.
const ask = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

let zoomCallback = null;
ipcRenderer.on('zoom-level-changed', (_event, level) => {
    if (zoomCallback && isNum(level, -10, 10)) { try { zoomCallback(level); } catch (e) { /* ignore */ } }
});

contextBridge.exposeInMainWorld('gvSettings', {
    // ---- read ----
    getInit: ask('settings-get-init'),                                  // { prefs, platform, defaults }
    getThemePalette: (theme) => (isTheme(theme) || theme === undefined ? ipcRenderer.invoke('get-theme-palette', theme) : Promise.resolve(null)),
    getThemePalettes: (ids) => (Array.isArray(ids) && ids.length <= 64 && ids.every(isTheme) ? ipcRenderer.invoke('get-theme-palettes', ids) : Promise.resolve({})),
    getZoomLevel: ask('get-zoom-level'),
    getStartAutomatically: ask('get-start-automatically'),
    getIconSets: ask('get-icon-sets'),
    getTopbarPresent: ask('get-topbar-present'),
    pickCustomIcon: ask('pick-custom-icon'),                            // opens the file picker; 'ok' | 'cancelled' | 'not-an-image'

    // ---- change a setting ----
    setTheme: send('pref-change-theme', isTheme),
    setZoom: send('pref-change-zoom', (v) => isNum(v, -7.6, 8.8)),
    setStartAutomatically: send('pref-change-start-automatically', isBool),
    setStartMinimized: send('pref-change-start-minimized', isBool),
    setExitOnClose: send('pref-change-exit-on-close', isBool),
    setHideDialerSidebar: send('pref-change-hide-dialer-sidebar', isBool),
    setCollapseSideNav: send('pref-change-collapse-side-nav', isBool),
    setHoverSideNav: send('pref-change-hover-side-nav', isBool),
    setSpellcheck: send('pref-change-spellcheck', isBool),
    setCopyCodes: send('pref-change-copy-codes', isBool),
    setCheckUpdates: send('pref-change-check-updates', isBool),
    setAppIcon: send('pref-change-app-icon', (v) => typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v)),
    setTopbarHidden: send('pref-change-topbar-hidden', isKeyList),

    // ---- window housekeeping ----
    fitHeight: send('settings-fit-height', (v) => isNum(v, 1, 5000)),
    ready: () => { ipcRenderer.send('settings-ready'); },
    onZoomLevelChanged: (callback) => { if (typeof callback === 'function') { zoomCallback = callback; } }
});

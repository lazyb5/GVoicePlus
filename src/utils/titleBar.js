/**********************************************************************************************************************
 * The custom title bar used on Windows and Linux (macOS keeps its native title bar and menu bar).
 *
 * The window is created with a hidden native title bar plus Electron's "title bar overlay", so the minimise / maximise /
 * close buttons stay native (snap layouts, resizing and dragging keep working) and take their colours from the theme.
 * The strip behind them is a small page (src/pages/titlebar.html) that shows the File / Edit / View / Help labels; clicking
 * one opens the matching submenu of the application's existing menu as a native popup, so every action and shortcut
 * stays defined in one place (main.js).
 **********************************************************************************************************************/

const path = require('path');

const HEIGHT = 32;   // px, the strip and the overlay buttons

// Only Windows and Linux use it.
const enabled = () => process.platform !== 'darwin';

// The strip's colours for a theme palette (see themePalette.js); null palette = the default light look.
function colours(palette) {
    return palette
        ? { bg: palette.bg, fg: palette.fg, hover: palette.surface }
        : { bg: '#ffffff', fg: '#202124', hover: '#e8eaed' };
}

// BrowserWindow options that hide the native title bar and keep native, themed caption buttons.
function windowOptions(palette) {
    const c = colours(palette);
    return { titleBarStyle: 'hidden', titleBarOverlay: { color: c.bg, symbolColor: c.fg, height: HEIGHT } };
}

// Recolours the caption buttons of an existing window (call when the theme changes).
function applyOverlay(win, palette) {
    if (!enabled() || !win || win.isDestroyed()) { return; }
    const c = colours(palette);
    win.setTitleBarOverlay({ color: c.bg, symbolColor: c.fg, height: HEIGHT });
}

// The page for the strip, with the colours passed in the query string so it never shows unthemed.
function pageFile() { return path.join(__dirname, '..', 'pages', 'titlebar.html'); }
function pageQuery(palette) {
    const c = colours(palette);
    return { bg: c.bg, fg: c.fg, hover: c.hover };
}

// Opens top-level menu number `index` of `menu` as a popup just under the label, at (x, y) in window coordinates.
function popupMenu(win, menu, index, x, y, onClosed) {
    const item = menu && menu.items[index];
    if (!item || !item.submenu) { return; }
    item.submenu.popup({ window: win, x: Math.round(x), y: Math.round(y), callback: onClosed });
}

module.exports = { HEIGHT, enabled, colours, windowOptions, applyOverlay, pageFile, pageQuery, popupMenu };

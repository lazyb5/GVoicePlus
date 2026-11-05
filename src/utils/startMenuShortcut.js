'use strict';
const path = require('path');

// The app's Windows app user model ID.  It must NOT equal build.appId in package.json: the installer stamps its own Start
// Menu shortcut (default exe icon) with that appId, and Windows shows the icon of whichever shortcut carries the window's
// ID in the taskbar, ignoring the icon chosen in Settings.  A different ID means the installer's shortcut never claims
// our window; the app writes its own shortcut with this ID and the chosen icon instead (main.js).
const APP_USER_MODEL_ID = 'GVoicePlus';

function startMenuShortcutPaths(appDataDir, programDataDir, name) {
    const rel = ['Microsoft', 'Windows', 'Start Menu', 'Programs', `${name}.lnk`];
    return { user: path.join(appDataDir, ...rel), all: path.join(programDataDir, ...rel) };
}

module.exports = { APP_USER_MODEL_ID, startMenuShortcutPaths };

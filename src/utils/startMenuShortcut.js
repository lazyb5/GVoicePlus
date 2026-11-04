'use strict';
const path = require('path');

// Must equal build.appId in package.json: the installer stamps its Start Menu shortcut with that ID,
// and Windows groups our windows (and their taskbar icon) under the shortcut whose ID matches.
const APP_USER_MODEL_ID = 'com.gvoiceplus.desktop';

function startMenuShortcutPaths(appDataDir, programDataDir, name) {
    const rel = ['Microsoft', 'Windows', 'Start Menu', 'Programs', `${name}.lnk`];
    return { user: path.join(appDataDir, ...rel), all: path.join(programDataDir, ...rel) };
}

// Only write our own shortcut when the installer's (or an earlier one) isn't already there.
function shouldWriteShortcut(paths, exists) {
    return !exists(paths.user) && !exists(paths.all);
}

module.exports = { APP_USER_MODEL_ID, startMenuShortcutPaths, shouldWriteShortcut };

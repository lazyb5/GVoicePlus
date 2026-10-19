/**********************************************************************************************************************
 * The app icons a person can choose in Settings ("App icon").  Each set names the image files, inside the images folder,
 * used for the Dock icon, the window icon (Windows/Linux), and the menu bar / tray icon with and without unread messages.
 *
 * On macOS the menu bar icon is a monochrome "template" image (the "Template" suffix tells Electron), which macOS draws
 * white or black to match the menu bar.  A template can't be coloured, so the unread state is a dot instead of the red
 * block the colour icon uses.  Windows and Linux use the colour icons.
 *
 * To add an icon: put its image files in the images folder and add one entry to SETS.  The Settings dropdown only shows
 * while there are two or more sets.
 **********************************************************************************************************************/

const constants = require('../constants');

const DEFAULT = 'classic';
const mac = process.platform === 'darwin';

const SETS = {
    classic: {
        label: 'Classic (Google Voice)',
        dock: constants.APPLICATION_ICON_LARGE,
        window: constants.APPLICATION_ICON_MEDIUM,
        tray: mac ? 'trayTemplate.png' : constants.APPLICATION_ICON_SMALL,
        trayDirty: mac ? 'trayDirtyTemplate.png' : constants.APPLICATION_ICON_SMALL_WITH_INDICATOR
    }
};

const has = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(SETS, id);

// The set for a saved choice; anything unknown (an old or edited setting) falls back to the default.
const get = (id) => { const key = has(id) ? id : DEFAULT; return Object.assign({ id: key }, SETS[key]); };

const list = () => Object.keys(SETS).map((id) => ({ id, label: SETS[id].label }));

module.exports = { DEFAULT, SETS, has, get, list };

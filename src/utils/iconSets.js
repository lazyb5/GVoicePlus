/**********************************************************************************************************************
 * The app icons a person can choose in Settings ("App icon").  Each set names the image files, inside the images folder,
 * used for the Dock icon, the window icon (Windows/Linux), and the menu bar / tray icon with and without unread messages.
 *
 * On macOS the menu bar icon is a monochrome "template" image (the "Template" suffix tells Electron), which macOS draws
 * white or black to match the menu bar.  A template can't be coloured, so the unread state is a dot instead of the red
 * block the colour icon uses.  Windows and Linux use the colour icons.
 *
 * To add an icon: put its image files in the images folder and add one entry to SETS.  The Settings dropdown only shows
 * while there are two or more sets.  (A person's own picture is handled separately, see customIcon.js.)
 **********************************************************************************************************************/

const DEFAULT = 'ocean';
const mac = process.platform === 'darwin';

// The speech-bubble icons are colourways of one design.  On a Mac they share one menu bar icon (a single-colour
// "template", so macOS draws it white or black); Windows and Linux use the coloured tray icons.
const bubble = (label, dir) => ({
    label,
    dock: `icons/${dir}/dock.png`,
    window: `icons/${dir}/window.png`,
    tray: mac ? 'icons/menubar/trayTemplate.png' : `icons/${dir}/tray.png`,
    trayDirty: mac ? 'icons/menubar/trayDirtyTemplate.png' : `icons/${dir}/trayDirty.png`
});

const SETS = {
    ocean: bubble('Ocean', 'ocean'),
    sunset: bubble('Sunset', 'sunset'),
    teal: bubble('Teal', 'teal'),
    violet: bubble('Violet', 'violet'),
    rose: bubble('Rose', 'rose'),
    graphite: bubble('Graphite', 'graphite'),
    snow: bubble('Snow', 'snow'),
    midnight: bubble('Midnight', 'midnight'),
    amber: bubble('Amber', 'amber'),
    mint: bubble('Mint', 'mint'),
    crimson: bubble('Crimson', 'crimson'),
    plum: bubble('Plum', 'plum'),
    sand: bubble('Sand', 'sand')
};

const has = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(SETS, id);

// The set for a saved choice; anything unknown (an old or edited setting) falls back to the default.
const get = (id) => { const key = has(id) ? id : DEFAULT; return Object.assign({ id: key }, SETS[key]); };

const list = () => Object.keys(SETS).map((id) => ({ id, label: SETS[id].label }));

module.exports = { DEFAULT, SETS, has, get, list };

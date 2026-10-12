#!/usr/bin/env node
/**
 * Brands the DEV copy of Electron (node_modules/electron/dist/Electron.app) with this app's icon and name, so the Dock,
 * Cmd+Tab and notifications show Google Voice instead of the Electron atom when you run `npm start`.  macOS only.
 * (The packaged app from `npm run build:mac:dir` already has the right icon; this is only for development runs.)
 *
 *   node scripts/brand-dev-electron.js [path/to/Electron.app]
 *
 * Run it while the app is NOT running.  It is also run automatically after `npm install`, because reinstalling
 * Electron restores the original icon.  It never fails the install: any problem is just reported.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

try {
    if (process.platform !== 'darwin') { process.exit(0); }
    const root = path.join(__dirname, '..');
    const app = process.argv[2] || path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
    const icon = path.join(root, 'build', 'icon.icns');
    if (!fs.existsSync(app) || !fs.existsSync(icon)) { console.log('brand-dev-electron: nothing to do'); process.exit(0); }

    const resources = path.join(app, 'Contents', 'Resources');
    const plist = path.join(app, 'Contents', 'Info.plist');

    // Keep the original icon once, so this can be undone.
    const backup = path.join(resources, 'electron.icns.orig');
    if (!fs.existsSync(backup)) { fs.copyFileSync(path.join(resources, 'electron.icns'), backup); }
    fs.copyFileSync(icon, path.join(resources, 'electron.icns'));

    const plistBuddy = (command) => {
        try { execFileSync('/usr/libexec/PlistBuddy', ['-c', command, plist], { stdio: 'ignore' }); return true; } catch (e) { return false; }
    };
    ['CFBundleDisplayName', 'CFBundleName'].forEach((key) => {
        if (!plistBuddy(`Set :${key} Google Voice`)) { plistBuddy(`Add :${key} string Google Voice`); }
    });

    // The bundle's contents changed, so re-sign it (ad hoc) or macOS may refuse to launch it.
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
    execFileSync('/usr/bin/touch', [app]);
    console.log('brand-dev-electron: branded ' + app);
} catch (e) {
    console.log('brand-dev-electron: skipped (' + e.message.split('\n')[0] + ')');
}

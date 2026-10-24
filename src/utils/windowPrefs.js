/**********************************************************************************************************************
 * The webPreferences of every window the app opens, in one place.  All three run sandboxed, with Node switched off and
 * context isolation on; each gets its own small preload script that exposes only what that window needs.  Nothing here
 * ever turns Node integration back on to make a feature work: a feature that needs the app gets a narrow, checked
 * method in that window's preload instead.
 *
 * No Electron code in this file, so tests can check the exact values main.js uses (test/windowPrefs.test.js).
 **********************************************************************************************************************/

const locked = {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    allowRunningInsecureContent: false
};

// The Google Voice page.  preload.js, spell checking on/off.  The window is only hidden (not closed) when you dismiss it,
// and Chromium slows a hidden page's timers to ~1/s, then ~1/min, which stalls inline replies and the unread watcher
// until the window is reopened, so background throttling stays off.
function page({ preload, spellcheck }) {
    return { ...locked, preload, spellcheck: !!spellcheck, backgroundThrottling: false };
}

// The Settings window (local file src/pages/customize.html).
function settings({ preload }) {
    return { ...locked, preload };
}

// The title bar strip on Windows and Linux (local file src/pages/titlebar.html).
function titleBar({ preload }) {
    return { ...locked, preload, backgroundThrottling: false };
}

module.exports = { page, settings, titleBar };

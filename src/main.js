// Requires
const { app, nativeImage, nativeTheme, BrowserWindow, Tray, Menu, ipcMain, BrowserView, WebContentsView, shell, powerMonitor, systemPreferences } = require('electron');
const constants = require('./constants');
const titleBar = require('./utils/titleBar');
const AutoLaunch = require('auto-launch')
const contextMenu = require('electron-context-menu');
const BadgeGenerator = require('./badge_generator');
const path = require('path');
const fs = require('fs');
const CSSInjector = require('./utils/cssInjector');
const topBar = require('./utils/topBar');
const sideNav = require('./utils/sideNav');
const unreadWatcher = require('./utils/unreadWatcher');
const imagePaste = require('./utils/imagePaste');
const themePalette = require('./utils/themePalette');
const accountMenuTheme = require('./utils/accountMenuTheme');
const Store = require('./utils/prefsStore');   // tiny replacement for electron-store (same config.json)
const { pathToFileURL } = require('url');
const urlPolicy = require('./utils/urlPolicy');
const ipcGuard = require('./utils/ipcGuard');
const windowPrefs = require('./utils/windowPrefs');
const { notificationShim } = require('./utils/notificationShim');

// Constants
const store = new Store();
const codeCopy = require('./utils/codeCopy').init({ getPrefs: () => store.get('prefs') || {} });   // copies verification codes when the setting is on
require('./utils/replyNotifications').init({ getWindow: () => page, isTrustedSender: (event) => senderIsPage(event), onMessage: (body) => (process.platform === 'win32' ? null : codeCopy.handle(body)) });   // Windows notifications have their own Copy button
// "Check for updates" (notify only): offers the download page when the GitHub repo in constants.js has a newer release.
const updates = require('./utils/updateCheck').init({
    getWindow: () => win,
    openExternal: (url) => openExternalSafe(url),
    getPrefs: () => store.get('prefs') || {},
    setPref: (key, value) => { const prefs = store.get('prefs') || {}; prefs[key] = value; store.set('prefs', prefs); }
});
const appPath = app.getAppPath();
const REFRESH_RATE = 60000; // 60 seconds: only a safety net now; unread changes arrive instantly from the page (unreadWatcher)
// The app icon is the one chosen in Settings ("App icon", prefs.appIcon).  iconSets.js lists the built-in choices;
// "custom" is a picture the person chose themselves (customIcon.js), kept in the app's data folder.
const iconSets = require('./utils/iconSets');
const customIcon = require('./utils/customIcon');
const imageFile = (file) => path.join(appPath, 'images', file);
const customIconFile = () => path.join(app.getPath('userData'), 'custom-icon.png');
const hasCustomIcon = () => fs.existsSync(customIconFile());

// The images for a choice.  Anything unknown, or a custom picture that has gone missing, gives the default set.
function loadIcons(id) {
    if (id === 'custom' && hasCustomIcon()) {
        // The picture is the Dock and window icon.  The menu bar / tray icon on a Mac stays a built-in one (it has to be a
        // single-colour template); on Windows and Linux it is the picture with an unread dot added.
        try {
            const file = customIconFile();
            const trayImages = process.platform === 'darwin' ? null : customIcon.trayImages(file);
            const builtin = iconSets.get('sunset');
            return {
                id: 'custom',
                window: file,
                dock: nativeImage.createFromPath(file),
                tray: trayImages ? trayImages.plain : imageFile(builtin.tray),
                trayDirty: trayImages ? trayImages.dirty : imageFile(builtin.trayDirty)
            };
        } catch (e) { console.log(`Could not use the custom icon: ${e && e.message}`); }
    }
    const set = iconSets.get(id === 'custom' ? undefined : id);
    return {
        id: set.id,
        window: imageFile(set.window),
        dock: nativeImage.createFromPath(imageFile(set.dock)),
        tray: imageFile(set.tray),
        trayDirty: imageFile(set.trayDirty)
    };
}
let icons = loadIcons(store.get('prefs.appIcon'));

// Switches every place the app icon appears to the chosen one, right away.
function applyIconSet(id) {
    icons = loadIcons(id);
    app.dock && app.dock.setIcon(icons.dock);
    tray && tray.setImage(lastNotification > 0 ? icons.trayDirty : icons.tray);
    if (process.platform !== 'darwin' && win && !win.isDestroyed()) { win.setIcon(icons.window); }   // macOS windows have no icon
}

// Developer aid: `GV_DEBUG_PORT=9222 npm start` exposes Chromium's debugging port on localhost only, so the page
// can be inspected from tools.  Does nothing unless that variable is set.
if (process.env.GV_DEBUG_PORT) {
    app.commandLine.appendSwitch('remote-debugging-port', process.env.GV_DEBUG_PORT);
    app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
}

// Lean launch settings: switch off Chromium background services this app never uses (casting/Chromecast discovery,
// on-device optimisation models, translation, autofill uploads, background update checks).  In a side-by-side test
// this cut idle memory by roughly 15-40% and sometimes one whole helper process.  Page loading, sign-in and
// notifications are unaffected.
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints,Translate,AutofillServerCommunication');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 900;

// Globals
let lastNotification = 0;
let badgeGenerator;
let cssInjector;
let tray;
let win;            // The main application window
let page;           // The Google Voice page: win itself on macOS; on Windows/Linux the view under the title bar (window calls go to win)
let appMenu;        // The application menu (File / Edit / View / Help), shown by the custom title bar on Windows/Linux
let settingsWindow; // When not null, the "Settings" window, which is currently open

// ====================================================================================================================
// Security helpers: who may navigate where, what may be opened outside the app, who may send IPC messages
// ====================================================================================================================
const SETTINGS_PAGE = path.join(appPath, 'src', 'pages', 'customize.html');
const THEMES_DIR = path.join(appPath, 'src', 'themes');
const pageOpenLimiter = ipcGuard.createRateLimiter(5, 10000);   // at most 5 links per 10 s that the PAGE asks us to open outside the app

// Only a host name or scheme is ever logged, never the whole address (it can carry tokens).
function hostOf(url) {
    const u = urlPolicy.parse(url);
    return u ? (u.hostname || u.protocol) : 'invalid address';
}

// The one place that hands an address to the operating system.  Only https:, http: and mailto: addresses go out
// (src/utils/urlPolicy.js); anything else (file:, other programs' schemes, javascript:, data: ...) is dropped.
function openExternalSafe(url) {
    const safe = urlPolicy.externalUrl(url);
    if (!safe) { console.log(`[nav] not opened outside the app: ${hostOf(url)}`); return; }
    Promise.resolve(shell.openExternal(safe)).catch((e) => console.log(`[nav] could not open a link: ${e && e.message}`));
}

// Theme names end up in file paths, so only a plain name of a theme that exists is accepted.
const RESERVED_THEME_FILES = ['base', 'mappings', 'm3'];
function knownTheme(id) {
    if (id === 'default') { return true; }
    if (!ipcGuard.isThemeId(id) || RESERVED_THEME_FILES.includes(id)) { return false; }
    return fs.existsSync(path.join(THEMES_DIR, `${id}.scss`)) || fs.existsSync(path.join(THEMES_DIR, 'compiled', `${id}.css`));
}
function currentTheme() {
    const theme = process.env.GV_THEME || store.get('prefs.theme') || constants.DEFAULT_SETTING_THEME;
    return knownTheme(theme) ? theme : 'default';
}

// The main window's web contents (the page itself; on Windows/Linux the view under the title bar strip).
function pageContents() {
    try { return win && !win.isDestroyed() ? page.webContents : null; } catch (e) { return null; }
}
function senderIsPage(event) { return ipcGuard.senderIsVoicePage(event, pageContents()); }
function senderIsSettings(event) {
    return !!settingsWindow && !settingsWindow.isDestroyed() && ipcGuard.senderIsLocalPage(event, settingsWindow.webContents, SETTINGS_PAGE);
}
function senderIsTitleBar(event) {
    return titleBar.enabled() && !!win && !win.isDestroyed() && ipcGuard.senderIsLocalPage(event, win.webContents, titleBar.pageFile());
}

// The main window may only show the app and Google sign-in (urlPolicy.APP_HOSTS).  A link the person clicks that leads
// anywhere else opens in their browser instead.  A redirect to anywhere else is cancelled (not opened in a browser, so a
// broken redirect can never open a browser window over and over).  Frames inside the page (Google's embedded widgets)
// are not restricted here.
function guardPageNavigation(contents) {
    contents.on('will-navigate', (event, url) => {
        const target = (event && event.url) || url;
        const verdict = urlPolicy.classify(target);
        if (verdict === 'app') { return; }
        event.preventDefault();
        console.log(`[nav] navigation to ${hostOf(target)} kept out of the app window`);
        if (verdict === 'external' && pageOpenLimiter()) { openExternalSafe(target); }
    });
    contents.on('will-redirect', (event, url) => {
        if (event && event.isMainFrame === false) { return; }
        const target = (event && event.url) || url;
        if (urlPolicy.classify(target) === 'app') { return; }
        event.preventDefault();
        console.log(`[nav] redirect to ${hostOf(target)} cancelled`);
    });
}

// The Settings window and the title bar strip show only their own local page: they never navigate and never open windows.
function guardLocalWindow(contents) {
    contents.on('will-navigate', (event) => { event.preventDefault(); });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// No window of ours may embed a <webview>.
app.on('web-contents-created', (event, contents) => {
    contents.on('will-attach-webview', (e) => { e.preventDefault(); });
});

// Only one instance of the app should run
if (!app.requestSingleInstanceLock()) {
    exitApplication();
}

app.on('second-instance', () => {
    showMainWindow();
});

// If the computer is shutting down or restarting then close
powerMonitor.on('shutdown', () => {
    exitApplication();
});

// Setup context menu
contextMenu({
    showSaveImage: true,
    showInspectElement: true
});

// If we're running on Windows, set our Application User Model ID to our application name.
// This will be displayed in all system Toasts that get generated to display notifications
// to the user.  If we don't do this, "electron.app.Electron" will be displayed instead.
if (isWindows()){
    app.setAppUserModelId(constants.APPLICATION_NAME);

    // Windows only shows (and reliably delivers) toasts for an app that has a Start Menu shortcut carrying its app ID.
    // Without one, Windows creates it when the first notification is sent and that first toast can be lost.  Creating
    // or refreshing the shortcut at startup avoids that.  The shortcut points at this exe and the app ID above.
    try {
        const shortcut = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${constants.APPLICATION_NAME}.lnk`);
        const options = { target: process.execPath, cwd: path.dirname(process.execPath), appUserModelId: constants.APPLICATION_NAME, icon: process.execPath, iconIndex: 0 };
        shell.writeShortcutLink(shortcut, fs.existsSync(shortcut) ? 'replace' : 'create', options);
    } catch (e) { console.log(`Could not write the Start Menu shortcut: ${e && e.message}`); }
}

// Ask for permission to use the microphone if the OS requires it
if (isMac()) {
    console.log('asking for microphone access');
    systemPreferences.askForMediaAccess("microphone");
}

// Show window when clicking on macosx dock icon
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }

    // Unhide on mac if dock icon is clicked
    if (win && !win.isVisible()) {
        win.show();
    }
});

// Setup timer to keep dock notifications up to date
setInterval(updateNotifications.bind(this, app), REFRESH_RATE);

app.whenReady().then(() => {
    // Set the Dock icon once the app is ready; setting it earlier can be ignored, which leaves the generic Electron icon.
    app.dock && app.dock.setIcon(icons.dock);
    createWindow();
});

// Themes only style the signed-in Google Voice app (voice.google.com/u/<n>/...).  The start-up / sign-in pages
// (the landing page, accounts.google.com) are left unthemed so they look normal.
function themeForCurrentPage(theme) {
    let url = '';
    try { url = page.webContents.getURL(); } catch (e) { /* window gone */ }
    const isApp = urlPolicy.isSignedInVoiceUrl(url);
    console.log(`Page ${hostOf(url)} -> ${isApp ? `theme ${theme}` : 'unthemed'}`);   // host only: a sign-in address carries session tokens
    return isApp ? theme : 'default';
}

// The selected theme's background colour as "#rrggbb" (white for the default theme).  Used as the window's own
// background so there is no white flash before the page and its theme have loaded.
function themeBackground(theme) {
    const pal = themePalette.get(appPath, theme);
    return (pal && /^#[0-9a-f]{6}$/i.test(pal.bg)) ? pal.bg : '#ffffff';
}

// On Windows, make the title bar (and system dialogs) follow the theme's light/dark scheme.  Windows draws the title bar
// itself, so this is light or dark only, not tinted with the theme's colours.
function applyNativeScheme(theme) {
    if (process.platform !== 'win32') { return; }
    const pal = themePalette.get(appPath, theme);
    nativeTheme.themeSource = pal ? pal.scheme : 'light';
}

// Creates and returns this application's main BrowserWindow, navigated to Google Voice.
function createWindow() {
    // Create the window, making it hidden initially.  If we have
    // it on record, re-apply the window size last set by the user.
    const prefs = store.get('prefs') || {};
    applyNativeScheme(currentTheme());
    const startTheme = currentTheme();
    const pagePrefs = windowPrefs.page({ preload: path.join(__dirname, 'preload.js'), spellcheck: prefs.spellcheck !== false });   // spell checking costs ~30 MB; can be switched off in Settings (restart to apply)
    win = new BrowserWindow({
        ...(titleBar.enabled() ? titleBar.windowOptions(themePalette.get(appPath, startTheme)) : {}),
        width: prefs.windowWidth || DEFAULT_WIDTH,
        height: prefs.windowHeight || DEFAULT_HEIGHT,
        backgroundColor: themeBackground(startTheme),
        icon: icons.window,
        show: false,
        // Windows/Linux: the window itself only shows the title bar strip; Google Voice lives in a view below it.
        webPreferences: titleBar.enabled() ? windowPrefs.titleBar({ preload: path.join(__dirname, 'titlebarPreload.js') }) : pagePrefs
    })
    page = win;
    if (titleBar.enabled()) {
        const view = new WebContentsView({ webPreferences: pagePrefs });
        view.setBackgroundColor(themeBackground(startTheme));
        win.contentView.addChildView(view);
        const layoutPage = () => {
            if (win.isDestroyed()) { return; }
            const [w, h] = win.getContentSize();
            const top = win.isFullScreen() ? 0 : titleBar.HEIGHT;   // full screen: the strip is hidden, the page fills the window
            view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
        };
        ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'show', 'restore'].forEach((ev) => win.on(ev, layoutPage));
        layoutPage();
        win.on('focus', () => { if (!win.isDestroyed()) { view.webContents.focus(); } });   // typing goes to Google Voice, not the strip
        page = new Proxy(win, {
            get(target, prop) {
                if (prop === 'webContents') { return view.webContents; }
                if (prop === 'loadURL') { return (...args) => view.webContents.loadURL(...args); }
                const v = target[prop];
                return typeof v === 'function' ? v.bind(target) : v;
            }
        });
        win.loadFile(titleBar.pageFile(), { query: titleBar.pageQuery(themePalette.get(appPath, startTheme)) });
    }
    guardPageNavigation(page.webContents);
    if (titleBar.enabled()) { guardLocalWindow(win.webContents); }   // Windows/Linux: win itself only shows the title bar strip
    if (process.env.GV_DEVTOOLS) { page.webContents.openDevTools({ mode: 'detach' }); }

    // Create the window's menu bar.
    let menuBar = appMenu = Menu.buildFromTemplate([
        {
            label: '&File',
            submenu: [
                {label: '&Reload',        click: () => {loadGoogleVoice();}},     // Reload Google Voice within our main window
                {label: 'Go to &website', click: () => {loadGoogleVoice(true);}}, // Open Google Voice externally in the user's browser
                {type:  'separator'},
                {label: '&Settings',      click: () => {showSettingsWindow()}},   // Open/display our Settings window
                {type:  'separator'},
                {
                  label: '&Close',                                                // Close the window
                  accelerator: isMac() ? 'Command+W' : 'Ctrl+W',
                  click: () => {win.close();}
                },
                {
                  label: '&Exit',                                                 // Exit the application
                  accelerator: isMac() ? 'Command+Q' : 'Ctrl+Shift+W',
                  click: () => {exitApplication();}
                }
            ]
        },
        {
            label: "Edit",
            submenu: [
                { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
                { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
                { type: "separator" },
                { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
                { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
                { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
                { label: "Select All", accelerator: "CmdOrCtrl+A", selector: "selectAll:" }
            ]
        },
        {
            label: '&View',
            submenu: [
                // The zoom keys always zoom the main window (never the Settings window), and the Settings zoom box follows them.
                {label: 'Zoom In',  visible: false, accelerator: 'CommandOrControl+Plus',  click: () => {zoomMainWindow(+0.5);}}, // Zoom in (Ctrl+Shift++)
                {label: 'Zoom In',  accelerator: 'CommandOrControl+=',                     click: () => {zoomMainWindow(+0.5);}}, // Zoom in (Ctrl+=)
                {label: 'Zoom Out', accelerator: 'CommandOrControl+-',                     click: () => {zoomMainWindow(-0.5);}}, // Zoom out (Ctrl+-)
                {label: 'Zoom Out', visible: false, accelerator: 'CommandOrControl+Shift+_', click: () => {zoomMainWindow(-0.5);}}, // Zoom out (Ctrl+Shift+_)
                {label: 'Actual Size', accelerator: 'CommandOrControl+0',                  click: () => {setMainZoom(0);}},        // Reset zoom (Ctrl+0)
                {type:  'separator'},
                {role:  'toggleFullScreen'}                                                  // Toggle full screen (F11)
            ]
        },
        {
            label: '&Help',
            submenu: [
                {label: 'Report a &bug',                 click: () => {openExternalSafe(constants.URL_GITHUB_REPORT_BUG);}},
                {label: 'Request a &feature',            click: () => {openExternalSafe(constants.URL_GITHUB_FEATURE_REQUEST);}},
                {label: 'Ask a &question',               click: () => {openExternalSafe(constants.URL_GITHUB_ASK_QUESTION);}},
                {label: 'View &issues',                  click: () => {openExternalSafe(constants.URL_GITHUB_VIEW_ISSUES);}},
                {type: 'separator'},
                {label: '&Security Policy',              click: () => {openExternalSafe(constants.URL_GITHUB_SECURITY_POLICY);}},
                {type: 'separator'},
                {label: 'Check for &updates...',         click: () => {updates.checkNow();}},
                {label: 'View &releases',                click: () => {openExternalSafe(constants.URL_GITHUB_RELEASES);}},
                {label: `&About (v${app.getVersion()})`, click: () => {openExternalSafe(constants.URL_GITHUB_README);}}
            ]
        }
    ]);

    // Set the menu bar's visibility.
    if (isMac()) {
        Menu.setApplicationMenu(menuBar) // On Mac, we always show the menu bar
    }
    else {
        // On Windows/Linux the menus are shown by the custom title bar strip.  The menu is still attached to the window so
        // its keyboard shortcuts work, but the native menu bar itself is never shown.
        win.setMenu(menuBar);
        win.setMenuBarVisibility(false);
    }

    // Navigate the window to Google Voice.  When it finishes loading, modify Google's markup as needed
    // to support user customizations that we allow the user to make from within our application UI.
    loadGoogleVoice();

    // Apply the theme as soon as the page's DOM exists (dom-ready), which is well before the page has finished
    // loading, so the page is never seen unthemed.  GV_THEME=<name> npm start overrides the saved theme (handy for testing).
    page.webContents.on('dom-ready', () => {
        const theme = currentTheme();
        cssInjector = new CSSInjector(app, page);
        cssInjector.injectTheme(themeForCurrentPage(theme))
            // The preload script already applied the theme before first paint; drop that copy now that this one is in.
            .then(() => page.webContents.executeJavaScript("var e = document.getElementById('gv-early-theme'); if (e) { e.remove(); }"))
            .catch(() => {});
    });

    page.webContents.on('did-finish-load', () => {
        if (!urlPolicy.isVoiceUrl(page.webContents.getURL())) { return; }   // the Google sign-in pages are left exactly as Google serves them
        const hideDialerSidebar = store.get('prefs.hideDialerSidebar') || constants.DEFAULT_HIDE_DIALER_SIDEBAR;
        cssInjector.showHideDialerSidebar(hideDialerSidebar);
        topBar.apply(page, hiddenTopBarItems());
        unreadWatcher.start(page);
        imagePaste.start(page);
    });

    // The profile-picture dropdown is a separate embedded page, so it is themed on its own (accountMenuTheme.js).  It loads
    // after the main page and may reload later, so every sub-frame that finishes loading triggers this.
    page.webContents.on('did-frame-finish-load', (event, isMainFrame) => {
        if (isMainFrame) { return; }
        const theme = currentTheme();
        accountMenuTheme.apply(page, themePalette.get(appPath, theme));
    });

    // Create our system notification area icon.
    if (tray) {
        tray.destroy;
    }
    tray = createTray(icons.tray, constants.APPLICATION_NAME);

    badgeGenerator = new BadgeGenerator(page);

    // NOTE: Electron 22+ removed the old 'new-window' event, so this must use setWindowOpenHandler.  With the old
    // handler, every link the page opened in a new window (e.g. Google Voice's own Settings) spawned a second,
    // unthemed window instead of being routed here.
    page.webContents.setWindowOpenHandler(({ url }) => {

        // A link that opens a new window.  If it is the Google Voice app or Google sign-in (see urlPolicy.js), the main window
        // navigates to it instead of opening a new window.  This supports adding accounts and switching between them.
        // Anything else is handed to the person's browser (https, http and mailto links only), where they are likely
        // already signed into services that need authentication (e.g. Spotify).  If the user ever gets stuck
        // somewhere that isn't the main Google Voice page, the "Reload" item in the menu or the notification area icon gets
        // them back to the Google Voice home page.
        const verdict = urlPolicy.classify(url);
        if (verdict === 'app') {
            page && page.loadURL(urlPolicy.parse(url).href);
        }
        else if (verdict === 'external') {
            if (pageOpenLimiter()) { openExternalSafe(url); }
        }
        else {
            console.log(`[nav] new window to ${hostOf(url)} refused`);
        }
        return { action: 'deny' }; // never let Electron open its own extra window
    });

    // Whenever a request is made for the window to be closed, determine whether we should allow the close to
    // happen and terminate the application, or just hide the window and keep running in the notification area.
    win.on('close', function (event) {
        // Proceed based on the reason why the window is being closed.
        if (app.isQuiting) {
            // The window is being closed as a result of us calling app.quit() due to the
            // user's invocation of one of our "Exit" menu items.  In this case, we'll
            // allow the close to happen.  This will lead to termination of the application.
        }
        else {
            // The window is being closed as a result of the user explicitly trying to close
            // it.  If the user has enabled the "exit on close" setting, allow the close and
            // subsequent termination of the application to proceed.  Otherwise, cancel the
            // close and hide the window instead; we'll keep running in the notification area.
            const exitOnClose = store.get('prefs.exitOnClose') || constants.DEFAULT_SETTING_EXIT_ON_CLOSE;
            if (!exitOnClose) {
                event.preventDefault();
                win.hide();
            }
        }
    });

    // If Google Voice's page has a "beforeunload" handler (for example while there is an unsent draft in the message
    // box), Electron silently cancels the quit and the app appears impossible to close.  When the user has asked to
    // exit, ignore that handler so the quit goes through.
    page.webContents.on('will-prevent-unload', (event) => {
        if (app.isQuiting) { event.preventDefault(); }
    });

    win.on('restore', function (event) {
        win.show();
    });

    win.on('resize', saveWindowSize);

    // Now that we've finished creating and initializing the window, show
    // it (unless the user has enabled the "start minimized" setting).
    if (!prefs.startMinimized) {
        win.show();
    }

    return win;
}

// Terminates this application.
function exitApplication() {
    app.isQuiting = true;
    app.quit();
}

// Loads Google Voice.  The "loadExternal" parameter specifies whether the load should
// take place inside this application's main browser window.  If set to false, Google
// Voice will be opened in the user's default external browser instead.  During the
// load, Google Voice itself takes care of asking the user to log in when necessary.
function loadGoogleVoice(loadExternal=false) {
    if (loadExternal) {openExternalSafe(constants.URL_GOOGLE_VOICE);}
    else              {page && page.loadURL(constants.URL_GOOGLE_VOICE);}
}

// Invoked every "REFRESH_RATE" seconds.  Parses the current notification count from Google
// Voice's markup and then has this application display it to the user in an appropriate way.
// Also implements a workaround for Electron's "blank white screen" bug that many users encounter.
function updateNotifications(app) {
    if (!win || BrowserWindow.getAllWindows().length === 0) {
        return;
    }

    // Safety net for the instant updates from unreadWatcher.  Returns null when the page isn't ready (loading, signed
    // out), in which case we keep the last known count instead of treating it as "zero unread".
    page.webContents.executeJavaScript(unreadWatcher.COUNT_EXPR).then(count => {
        const n = ipcGuard.cleanCount(count);   // the answer comes from the page: only a whole number is accepted
        if (n === null) { return; }
        processNotificationCount(app, n);
    }).catch(() => {});

    // The following is a workaround for the Electron bug where after an indeterminate
    // period of inactivity, the main application window turns into a blank white screen.
    // When this happens, inspection shows that the loaded page consists of the following
    // empty HTML markup:
    //
    //     <html><head></head><body></body></html>
    //
    // As such, we perform a simple check as to whether the <body/> of our loaded page
    // has become empty.  If it has, then we automatically reload Google Voice for the
    // user.  This seems to eliminate the problem entirely, without any adverse effects,
    // as once we detect an empty body, the application is already in a non-working state.
    page.webContents.executeJavaScript("document.querySelector('body').childNodes.length").then(
        (result) => {
            if (result === 0){
                loadGoogleVoice();
            }
        })
}

// Displays a specified notification count to the user (if it isn't already
// being displayed), in a way that is appropriate for their Operating System.
function processNotificationCount(app, count) {
    if (count !== lastNotification) {
        // Update our record of what the new count is.  We update our record *before* proceeding to ensure we don't
        // enter a loop of continuously trying to update UI in the event that we experience some failure down below.
        let oldCount = lastNotification;
        lastNotification = count;

        // Perform OS-specific operations.
        if (isMac()) {
            processNotificationCount_MacOS(app, oldCount, count);
        }
        else if (isWindows()) {
            processNotificationCount_Windows(oldCount, count);
        }
        
        // Update our notification area icon based on the count.  If it's greater than 0,
        // display the icon with a red dot, otherwise display the icon without a red dot.
        if (count > 0) {
            tray && tray.setImage(icons.trayDirty);
        }
        else {
            tray && tray.setImage(icons.tray);
        }
    }
}

// Updates this application's UI on Windows in a way that is appropriate for a specified notification count.
function processNotificationCount_Windows(oldCount, newCount) {
    if (win) {
        // If the specified new count is non-0, use our Badge Generator to dynamically generate an image representing it,
        // and then apply the image as an overlay icon on our main window's Taskbar button.  Note that if the user has
        // the "Use small Taskbar buttons" setting turned on, the overlay won't actually be rendered due to lack of space.
        if (newCount) {
            badgeGenerator.generate(newCount).then((base64) => {
                const image = nativeImage.createFromDataURL(base64);
                win.setOverlayIcon(image, 'You have new messages and/or calls');
            });
        } else {
            win.setOverlayIcon(null, '');
        }

        // If the notification count has gone up and our main window isn't currently
        // focused, also flash the window's Taskbar button to catch the user's attention.  
        if ((newCount > oldCount) && !win.isFocused()) {
            win.flashFrame(true);
        }
    }
}

// Updates this application's UI on Mac OS in a way that is appropriate for a specified notification count.
function processNotificationCount_MacOS(app, oldCount, newCount) {
    // Overlay the specified new count on our Dock icon.  If the count has
    // increased, also bouce the icon the catch the user's attention.
    if (app.dock) {
        app.dock.setBadge(`${newCount || ''}`);
        if (newCount > oldCount) {
            app.dock.bounce();
        }
    }
}

// Creates this application's notification area icon.
function createTray(iconPath, tipText) {
    // Create the icon, assigning it our application icon and name.
    let appIcon = new Tray(iconPath);
	appIcon.setToolTip(tipText);

    // Construct the icon's context menu.  This is done using an array of MenuItem objects.
    appIcon.setContextMenu(Menu.buildFromTemplate([
        {label: '&Open',     click: () => {showMainWindow();}},
        {label: '&Reload',   click: () => {loadGoogleVoice();}},
        {type:  'separator'},
        {label: '&Settings', click: () => {showSettingsWindow();}},
        {type:  'separator'},
        {label: '&Exit',     click: () => {exitApplication();}}
    ]));

    appIcon.on('click', function (event) {
        showMainWindow();
    });

    return appIcon;
}

// Displays this application's main window to the user.
function showMainWindow() {
    win && win.show();
}

// When the Settings window closes, the main window gets keyboard focus back, and it can land on a button such as the profile
// picture, which makes Google draw its focus ring and show its tooltip for no visible reason.  Let go of a focused button or
// link (in the page and in the frames Google embeds in it), but never of a text box, so a draft is left exactly as it is.
function releaseButtonFocus() {
    try {
        if (!win || win.isDestroyed()) { return; }
        const script = `(function () {
            var a = document.activeElement;
            if (!a || a === document.body || a === document.documentElement || a.tagName === 'IFRAME') { return 'none'; }
            if (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.getAttribute('role') === 'textbox') { return 'kept'; }
            a.blur();
            return 'released';
        })()`;
        for (const frame of page.webContents.mainFrame.framesInSubtree) {
            frame.executeJavaScript(script).catch(() => { /* frame went away */ });
        }
    } catch (e) { console.log('Releasing focus failed:', e.message); }
}

// Sets the main window's zoom level (kept between 25% and 500%, like the Settings zoom box) and tells the open
// Settings window, so its zoom box always shows the real level.
function setMainZoom(level) {
    level = Math.min(8.8, Math.max(-7.6, level));
    page.webContents.setZoomLevel(level);
    if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.webContents.send('zoom-level-changed', level); }
}
function zoomMainWindow(step) { setMainZoom(page.webContents.getZoomLevel() + step); }

// Creates (if it doesn't already exist) this application's "Settings" window, and then displays it to the user.
function showSettingsWindow() {
    if (!settingsWindow || settingsWindow.isDestroyed()) {
        // Create our Settings window, keeping a global reference to it.  This reference allows
        // us to know when the window is open, preventing the user from opening it a second time.
        settingsWindow = new BrowserWindow({
            width: 680,
            height: 585,
            title: 'Settings',
            parent: win,
            modal: true,
            resizable: false,
            minimizable: false,
            show: false,   // shown once the page has applied its theme (see 'settings-ready'), so it never flashes white
            backgroundColor: themeBackground(currentTheme()),
            webPreferences: windowPrefs.settings({ preload: path.join(__dirname, 'settingsPreload.js') })
        });
        settingsWindow.removeMenu();
        guardLocalWindow(settingsWindow.webContents);
        settingsWindow.webContents.setZoomLevel(0);                  // the Settings window stays at 100%; zoom only changes the main window
        settingsWindow.webContents.setVisualZoomLevelLimits(1, 1);   // no pinch zoom either
        settingsWindow.webContents.on('did-finish-load', () => { settingsWindow.webContents.setZoomLevel(0); });

        // Safety net: show the window anyway if the page never reports in.
        const settingsShowTimer = setTimeout(() => {
            if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.isVisible()) { settingsWindow.show(); }
        }, 2000);
        
        // Load our settings page into the window.  The page reads its settings through window.gvSettings (settingsPreload.js).
        settingsWindow.loadFile(SETTINGS_PAGE);
        //settingsWindow.webContents.openDevTools();

        // When the window gets closed, release its global reference.
        settingsWindow.on('close', function() {
            clearTimeout(settingsShowTimer);
            settingsWindow = null;
            setTimeout(releaseButtonFocus, 250);   // once the main window has taken keyboard focus back
        });
    }
    else {
        // Our Settings window is already open, just bring it back to the foreground.
        settingsWindow.show();
    }
}

function saveWindowSize() {
    const bounds = win.getBounds();
    const prefs = store.get('prefs')  || {};
    prefs.windowWidth = bounds.width;
    prefs.windowHeight = bounds.height;

    store.set('prefs', prefs);
}

// ====================================================================================================================
// Helper Functions
// ====================================================================================================================

function isMac()     {return (process.platform === 'darwin');}
function isWindows() {return (process.platform === 'win32');}

// ====================================================================================================================
// IPC handlers
// ====================================================================================================================
// Every handler first checks WHO sent the message and WHAT it contains (src/utils/ipcGuard.js).  There are three kinds of
// sender: the Google Voice page (through preload.js), the Settings window and the title bar strip.  A message from any other
// window or frame, or with an unexpected argument, is ignored (a question gets an error back).  The log line never contains
// the message itself.

const none = (...args) => args.length === 0;
const isBool = ipcGuard.isBool;
const logRejected = (channel) => console.log(`[ipc] ${channel} ignored: unexpected sender or argument`);

function listen(isSender, channel, valid, handler) {
    ipcMain.on(channel, (event, ...args) => {
        if (!isSender(event) || !valid(...args)) { logRejected(channel); return; }
        try { handler(event, ...args); } catch (e) { console.log(`[ipc] ${channel} failed: ${e && e.message}`); }
    });
}

function answer(isSender, channel, valid, handler) {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isSender(event) || !valid(...args)) { logRejected(channel); throw new Error('Not allowed'); }
        return handler(event, ...args);
    });
}

// Saves one setting and returns the whole settings object.
function savePref(key, value) {
    const prefs = store.get('prefs') || {};
    prefs[key] = value;
    store.set('prefs', prefs);
    return prefs;
}

// ---- The Google Voice page (preload.js) ------------------------------------------------------------------------------

// Asked (synchronously) by the main window's preload script at the start of every Google Voice page load.  Answers with the
// theme CSS to apply before first paint (null when the page should stay unthemed), whether the sidebar is collapsed, and the
// text of the Notification stand-in.  Always answers, because the page is waiting; anything but the Voice page gets null.
// The reply is the FIRST value given to event.returnValue; a later assignment is ignored (the preload would get null and
// start nothing), so it is assigned exactly once, at the end, on every path (test/windowSecurity.test.js checks this).
ipcMain.on('gv-init', (event, ...args) => {
    let reply = null;
    if (!none(...args) || !senderIsPage(event)) {
        logRejected('gv-init');
    } else {
        try {
            const theme = currentTheme();
            const url = ipcGuard.frameOf(event).url;
            reply = {
                earlyThemeCss: (theme !== 'default' && urlPolicy.isSignedInVoiceUrl(url)) ? CSSInjector.themeCss(app, theme) : null,
                nav: { collapse: !!store.get('prefs.collapseSideNav'), hover: !!store.get('prefs.hoverSideNav') },
                shimSource: notificationShim.toString()
            };
        } catch (e) { console.log(`[ipc] gv-init failed: ${e && e.message}`); }
    }
    event.returnValue = reply;
});

// Unread count pushed by the page the moment it changes.
listen(senderIsPage, 'gv-unread', (count) => ipcGuard.cleanCount(count) !== null, (e, count) => { processNotificationCount(app, count); });

// The user clicked a notification (the page's stand-in has been told; this brings the window forward).
listen(senderIsPage, 'notification-clicked', none, () => { showMainWindow(); });

// ---- The title bar strip (Windows and Linux) -------------------------------------------------------------------------

// A label in the custom title bar was clicked: open that menu as a native popup under it.
listen(senderIsTitleBar, 'titlebar-menu', (index, x, y) => ipcGuard.isInt(index, 0, 7) && ipcGuard.isNum(x, 0, 20000) && ipcGuard.isNum(y, 0, 20000), (e, index, x, y) => {
    titleBar.popupMenu(win, appMenu, index, x, y, () => {
        if (win.isDestroyed()) { return; }
        win.webContents.send('titlebar-menu-closed');
        page.webContents.focus();
    });
});

// ---- Settings window messages ----------------------------------------------------------------------------------------

// What the Settings page needs to start: the saved settings, the platform and the built-in defaults.
answer(senderIsSettings, 'settings-get-init', none, () => ({
    prefs: store.get('prefs') || {},
    platform: process.platform,
    defaults: {
        DEFAULT_SETTING_THEME: constants.DEFAULT_SETTING_THEME,
        DEFAULT_SETTING_START_MINIMIZED: constants.DEFAULT_SETTING_START_MINIMIZED,
        DEFAULT_SETTING_EXIT_ON_CLOSE: constants.DEFAULT_SETTING_EXIT_ON_CLOSE,
        DEFAULT_HIDE_DIALER_SIDEBAR: constants.DEFAULT_HIDE_DIALER_SIDEBAR
    }
}));

// Returns the current zoom level of this this application's main window.
answer(senderIsSettings, 'get-zoom-level', none, () => page.webContents.getZoomLevel());

// Returns a bool indicating whether this application is registered to start automatically at logon.
answer(senderIsSettings, 'get-start-automatically', none, async () => {
    let autoLaunch = new AutoLaunch({name: constants.APPLICATION_NAME, path: app.getPath('exe')})
    return await autoLaunch.isEnabled();
});

// Colours of the selected theme, so the Settings window can match it.
answer(senderIsSettings, 'get-theme-palette', (theme) => theme === undefined || theme === null || ipcGuard.isThemeId(theme), (e, theme) => themePalette.get(appPath, theme || currentTheme()));
// The colours of several themes at once, for the swatches in the Settings window (null = no colours known, e.g. Default).
answer(senderIsSettings, 'get-theme-palettes', (ids) => Array.isArray(ids) && ids.length <= 64 && ids.every(ipcGuard.isThemeId), (e, ids) => {
    const out = {};
    ids.forEach((id) => { out[id] = themePalette.get(appPath, id); });
    return out;
});

// The Settings page reports how tall its tallest tab is; grow the window to fit (never smaller than the default,
// never taller than the screen) so no tab needs scrolling.
listen(senderIsSettings, 'settings-fit-height', (height) => ipcGuard.isNum(height, 1, 5000), (e, height) => {
    if (!settingsWindow || settingsWindow.isDestroyed()) { return; }
    const area = require('electron').screen.getDisplayMatching(settingsWindow.getBounds()).workArea;
    const [width, current] = settingsWindow.getContentSize();
    const fitted = Math.min(Math.max(Math.round(height), current), area.height - 60);
    if (fitted !== current) { settingsWindow.setContentSize(width, fitted); settingsWindow.center(); }
});

// Called by the Settings page once it has applied the theme colours; only then is the window shown.
listen(senderIsSettings, 'settings-ready', none, () => {
    if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.isVisible()) { settingsWindow.show(); }
});

// Called when the theme has been changed.
listen(senderIsSettings, 'pref-change-theme', (theme) => ipcGuard.isThemeId(theme) && knownTheme(theme), (e, theme) => {
    console.log(`Theme changed to: ${theme}`);

    // Apply the selected them and then save the selection to the user's settings store.
    const pageTheme = themeForCurrentPage(theme);
    cssInjector.injectTheme(pageTheme);
    accountMenuTheme.apply(page, themePalette.get(appPath, theme));
    applyNativeScheme(theme);
    if (titleBar.enabled()) {
        const pal = themePalette.get(appPath, theme);
        titleBar.applyOverlay(win, pal);
        win.webContents.send('titlebar-colours', titleBar.colours(pal));
    }
    savePref('theme', theme);
});

// Called when the zoom level has been changed.
listen(senderIsSettings, 'pref-change-zoom', (level) => ipcGuard.isNum(level, -7.6, 8.8), (e, level) => {
    console.log(`Zoom level changed to: ${level}`);

    // Apply the newly selected zoom level.  Note that there is no need to save this setting to
    // the user's settings store.  Electron handles remembering our main window's zoom level by
    // default, so it will automatically be restored the next time the application is launched.
    setMainZoom(level);
});

// Called when the "start automatically" checkbox has been checked/unchecked.
listen(senderIsSettings, 'pref-change-start-automatically', isBool, (e, startAutomatically) => {
    console.log(`"Start Automatically" changed to: ${startAutomatically}`);

    // Register/unregister this application to be automatically started at logon.
    let autoLaunch = new AutoLaunch({name: constants.APPLICATION_NAME, path: app.getPath('exe')})
    if (startAutomatically) {
        autoLaunch.enable();
    }
    else {
        autoLaunch.disable();
    }
});

// Called when the "start minimized" checkbox has been checked/unchecked.
listen(senderIsSettings, 'pref-change-start-minimized', isBool, (e, startMinimized) => {
    console.log(`"Start Minimized" changed to: ${startMinimized}`);
    savePref('startMinimized', startMinimized);
});

// Called when the "spell check" checkbox has been checked/unchecked.  The window reads it when it is created,
// so it takes effect the next time the app starts.
listen(senderIsSettings, 'pref-change-spellcheck', isBool, (e, enabled) => { savePref('spellcheck', enabled); });

// Called when the "copy verification codes" checkbox has been checked/unchecked.  Off by default; codeCopy.js reads
// the setting for every message, so it takes effect immediately.
listen(senderIsSettings, 'pref-change-copy-codes', isBool, (e, enabled) => { savePref('copyCodes', enabled); });

// The icon choices for the Settings dropdown: the built-in ones, whether a custom picture exists, and the one in use.
answer(senderIsSettings, 'get-icon-sets', none, () => ({
    sets: iconSets.list(),
    current: icons.id,
    hasCustom: hasCustomIcon(),
    customFileUrl: hasCustomIcon() ? pathToFileURL(customIconFile()).href : null
}));

// Called when a different "App icon" is picked.  Applies at once and is remembered for next time.
listen(senderIsSettings, 'pref-change-app-icon', (id) => typeof id === 'string' && (iconSets.has(id) || (id === 'custom' && hasCustomIcon())), (e, id) => {
    savePref('appIcon', id);
    applyIconSet(id);
});

// "Choose your own image...": shows a file picker; a usable picture is saved and applied.  Answers 'ok', 'cancelled'
// or 'not-an-image'.
answer(senderIsSettings, 'pick-custom-icon', none, async (e) => {
    const result = await customIcon.pick(BrowserWindow.fromWebContents(e.sender), customIconFile());
    if (result === 'ok') {
        savePref('appIcon', 'custom');
        applyIconSet('custom');
    }
    return result;
});

// Called when the "check for updates" checkbox has been checked/unchecked.
listen(senderIsSettings, 'pref-change-check-updates', isBool, (e, enabled) => { savePref('checkForUpdates', enabled); });

// Called when the "exit on close" checkbox has been checked/unchecked.
listen(senderIsSettings, 'pref-change-exit-on-close', isBool, (e, exitOnClose) => {
    console.log(`"Exit on close" changed to: ${exitOnClose}`);
    savePref('exitOnClose', exitOnClose);
});

// Called when the "show sidebar on hover" checkbox has been checked/unchecked.
listen(senderIsSettings, 'pref-change-hover-side-nav', isBool, (e, hover) => {
    savePref('hoverSideNav', hover);
    sideNav.setHover(page, hover);
});

// Called when the "collapse sidebar" checkbox has been checked/unchecked.  Collapses (or re-opens) it right away.
listen(senderIsSettings, 'pref-change-collapse-side-nav', isBool, (e, collapse) => {
    savePref('collapseSideNav', collapse);
    sideNav.setCollapsed(page, collapse);
});

// Called when the "hide dialer sidebar" checkbox has been checked/unchecked.
listen(senderIsSettings, 'pref-change-hide-dialer-sidebar', isBool, (e, hideDialerSidebar) => {
    console.log(`Hide dialer sidebar changed to: ${hideDialerSidebar}`);
    cssInjector.showHideDialerSidebar(hideDialerSidebar);
    savePref('hideDialerSidebar', hideDialerSidebar);
});

// Which top-bar items are hidden.  Older versions only had a "hide Upgrade" checkbox, so honour that until the user
// has chosen items with the new editor.
function hiddenTopBarItems() {
    const prefs = store.get('prefs') || {};
    if (Array.isArray(prefs.hiddenTopBarItems)) { return prefs.hiddenTopBarItems.filter((k) => topBar.KEYS.includes(k)); }
    return prefs.hideUpgradeButton ? ['upgrade'] : [];
}

// Which top-bar items exist on this account's page (null = unknown), so Settings can grey out the ones that don't.  The
// answer comes from the Google page, so only the known item names are passed on.
answer(senderIsSettings, 'get-topbar-present', none, async () => {
    const keys = await topBar.present(page);
    return Array.isArray(keys) ? keys.filter((k) => topBar.KEYS.includes(k)) : null;
});

// The top-bar picture in Settings: save which items are hidden and apply it to the open page straight away.
listen(senderIsSettings, 'pref-change-topbar-hidden', (keys) => Array.isArray(keys) && keys.length <= 32 && keys.every((k) => typeof k === 'string'), (e, keys) => {
    const hidden = keys.filter((k) => topBar.KEYS.includes(k));
    const prefs = store.get('prefs') || {};
    prefs.hiddenTopBarItems = hidden;
    delete prefs.hideUpgradeButton;
    store.set('prefs', prefs);
    topBar.apply(page, hidden);
});

// Requires
const { app, nativeImage, BrowserWindow, Tray, Menu, ipcMain, BrowserView, shell, powerMonitor, systemPreferences } = require('electron');
const constants = require('./constants');
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
const Url = require('url');

// Constants
const store = new Store();
const codeCopy = require('./utils/codeCopy').init({ getPrefs: () => store.get('prefs') || {} });   // copies verification codes when the setting is on
require('./utils/replyNotifications').init({ getWindow: () => win, onMessage: (body) => codeCopy.handle(body) });
// "Check for updates" (notify only): offers the download page when the GitHub repo in constants.js has a newer release.
const updates = require('./utils/updateCheck').init({
    getWindow: () => win,
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
let settingsWindow; // When not null, the "Settings" window, which is currently open

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
}

// Setup notification shim to focus window
ipcMain.on('notification-clicked', () => {
    showMainWindow();
});

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
    try { url = win.webContents.getURL(); } catch (e) { /* window gone */ }
    const isApp = /^https:\/\/voice\.google\.com\/u\/\d+(\/|$)/.test(url);
    console.log(`Page ${url} -> ${isApp ? `theme ${theme}` : 'unthemed'}`);
    return isApp ? theme : 'default';
}

// The selected theme's background colour as "#rrggbb" (white for the default theme).  Used as the window's own
// background so there is no white flash before the page and its theme have loaded.
function themeBackground(theme) {
    const pal = themePalette.get(appPath, theme);
    return (pal && /^#[0-9a-f]{6}$/i.test(pal.bg)) ? pal.bg : '#ffffff';
}

// Creates and returns this application's main BrowserWindow, navigated to Google Voice.
function createWindow() {
    // Create the window, making it hidden initially.  If we have
    // it on record, re-apply the window size last set by the user.
    const prefs = store.get('prefs') || {};
    win = new BrowserWindow({
        width: prefs.windowWidth || DEFAULT_WIDTH,
        height: prefs.windowHeight || DEFAULT_HEIGHT,
        backgroundColor: themeBackground(process.env.GV_THEME || prefs.theme || constants.DEFAULT_SETTING_THEME),
        icon: icons.window,
        show: false,
        webPreferences: {
            spellcheck: prefs.spellcheck !== false,   // on by default; costs ~30 MB, can be switched off in Settings (restart to apply)
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
            // The window is only hidden (not closed) when you dismiss it.  Chromium slows a hidden page's timers to
            // ~1/s, then ~1/min, which stalls inline replies and the unread watcher until the window is reopened.
            backgroundThrottling: false
        }
    })
    if (process.env.GV_DEVTOOLS) { win.webContents.openDevTools({ mode: 'detach' }); }

    // Create the window's menu bar.
    let menuBar = Menu.buildFromTemplate([
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
                {role:  'toggleFullScreen'},                                                 // Toggle full screen (F11)
                {type:  'separator'},
                {label: '&Hide menu bar', visible: !isMac(), click: () => {win.setMenuBarVisibility(false);}} // Hide the menu bar (not supported for Mac)
            ]
        },
        {
            label: '&Help',
            submenu: [
                {label: 'Report a &bug',                 click: () => {shell.openExternal(constants.URL_GITHUB_REPORT_BUG);}},
                {label: 'Request a &feature',            click: () => {shell.openExternal(constants.URL_GITHUB_FEATURE_REQUEST);}},
                {label: 'Ask a &question',               click: () => {shell.openExternal(constants.URL_GITHUB_ASK_QUESTION);}},
                {label: 'View &issues',                  click: () => {shell.openExternal(constants.URL_GITHUB_VIEW_ISSUES);}},
                {type: 'separator'},
                {label: '&Security Policy',              click: () => {shell.openExternal(constants.URL_GITHUB_SECURITY_POLICY);}},
                {type: 'separator'},
                {label: 'Check for &updates...',         click: () => {updates.checkNow();}},
                {label: 'View &releases',                click: () => {shell.openExternal(constants.URL_GITHUB_RELEASES);}},
                {label: `&About (v${app.getVersion()})`, click: () => {shell.openExternal(constants.URL_GITHUB_README);}}
            ]
        }
    ]);

    // Set the menu bar's visibility.
    if (isMac()) {
        Menu.setApplicationMenu(menuBar) // On Mac, we always show the menu bar
    }
    else {
        // On Windows/Linux, we give the user a setting for hiding the menu bar.  Add the menu bar to
        // the window (which ensures that its keyboard shortcuts will work regardless of the menu bar's
        // visibility), but make the menu bar visible only if the user hasn't asked us to hide it.
        win.setMenu(menuBar);
        if (((prefs.showMenuBar != undefined) && !prefs.showMenuBar) || !constants.DEFAULT_SETTING_SHOW_MENU_BAR) {
            win.setMenuBarVisibility(false);
        }
    }

    // Navigate the window to Google Voice.  When it finishes loading, modify Google's markup as needed
    // to support user customizations that we allow the user to make from within our application UI.
    loadGoogleVoice();

    // Apply the theme as soon as the page's DOM exists (dom-ready), which is well before the page has finished
    // loading, so the page is never seen unthemed.  GV_THEME=<name> npm start overrides the saved theme (handy for testing).
    win.webContents.on('dom-ready', () => {
        const theme = process.env.GV_THEME || store.get('prefs.theme') || constants.DEFAULT_SETTING_THEME;
        cssInjector = new CSSInjector(app, win);
        cssInjector.injectTheme(themeForCurrentPage(theme))
            // The preload script already applied the theme before first paint; drop that copy now that this one is in.
            .then(() => win.webContents.executeJavaScript("var e = document.getElementById('gv-early-theme'); if (e) { e.remove(); }"))
            .catch(() => {});
    });

    win.webContents.on('did-finish-load', () => {
        const hideDialerSidebar = store.get('prefs.hideDialerSidebar') || constants.DEFAULT_HIDE_DIALER_SIDEBAR;
        cssInjector.showHideDialerSidebar(hideDialerSidebar);
        topBar.apply(win, hiddenTopBarItems());
        unreadWatcher.start(win);
        imagePaste.start(win);
    });

    // The profile-picture dropdown is a separate embedded page, so it is themed on its own (accountMenuTheme.js).  It loads
    // after the main page and may reload later, so every sub-frame that finishes loading triggers this.
    win.webContents.on('did-frame-finish-load', (event, isMainFrame) => {
        if (isMainFrame) { return; }
        const theme = process.env.GV_THEME || store.get('prefs.theme') || constants.DEFAULT_SETTING_THEME;
        accountMenuTheme.apply(win, themePalette.get(appPath, theme));
    });

    // Create our system notification area icon.
    if (tray) {
        tray.destroy;
    }
    tray = createTray(icons.tray, constants.APPLICATION_NAME);

    badgeGenerator = new BadgeGenerator(win);

    // NOTE: Electron 22+ removed the old 'new-window' event, so this must use setWindowOpenHandler.  With the old
    // handler, every link the page opened in a new window (e.g. Google Voice's own Settings) spawned a second,
    // unthemed window instead of being routed here.
    win.webContents.setWindowOpenHandler(({ url }) => {

        // If the target URL is a Google Voice URL, have our main window navigate to it instead of opening
        // it in a new window.  This supports the ability to add additional accounts and switch between
        // them on-demand.  Otherwise, for all other URLs, have the system open them using the default type
        // handler.  This is done to force URLs to open in the user's browser, where they are likely already
        // signed into services that need authentication (e.g. Spotify).  Note that if the user ever gets
        // stuck navigated somewhere that isn't the main Google Voice page, they can always use the "Reload"
        // item in the notification area icon context menu to get back to the Google Voice home page.
        const hostName = Url.parse(url).hostname;
        if ( hostName === 'voice.google.com' || hostName === 'accounts.google.com') {
            win && win.loadURL(url);
        }
        else {
            shell.openExternal(url);
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
    win.webContents.on('will-prevent-unload', (event) => {
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
    if (loadExternal) {shell.openExternal(constants.URL_GOOGLE_VOICE);}
    else              {win && win.loadURL(constants.URL_GOOGLE_VOICE);}
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
    win.webContents.executeJavaScript(unreadWatcher.COUNT_EXPR).then(count => {
        if (count === null) { return; }
        processNotificationCount(app, count);
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
    win.webContents.executeJavaScript("document.querySelector('body').childNodes.length").then(
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
        for (const frame of win.webContents.mainFrame.framesInSubtree) {
            frame.executeJavaScript(script).catch(() => { /* frame went away */ });
        }
    } catch (e) { console.log('Releasing focus failed:', e.message); }
}

// Sets the main window's zoom level (kept between 25% and 500%, like the Settings zoom box) and tells the open
// Settings window, so its zoom box always shows the real level.
function setMainZoom(level) {
    level = Math.min(8.8, Math.max(-7.6, level));
    win.webContents.setZoomLevel(level);
    if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.webContents.send('zoom-level-changed', level); }
}
function zoomMainWindow(step) { setMainZoom(win.webContents.getZoomLevel() + step); }

// Creates (if it doesn't already exist) this application's "Settings" window, and then displays it to the user.
function showSettingsWindow() {
    if (!settingsWindow) {
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
            backgroundColor: themeBackground(store.get('prefs.theme') || constants.DEFAULT_SETTING_THEME),
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }});
        settingsWindow.removeMenu();
        settingsWindow.webContents.setZoomLevel(0);                  // the Settings window stays at 100%; zoom only changes the main window
        settingsWindow.webContents.setVisualZoomLevelLimits(1, 1);   // no pinch zoom either
        settingsWindow.webContents.on('did-finish-load', () => { settingsWindow.webContents.setZoomLevel(0); });

        // Safety net: show the window anyway if the page never reports in.
        const settingsShowTimer = setTimeout(() => {
            if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.isVisible()) { settingsWindow.show(); }
        }, 2000);
        
        // Stash the user's settings store on the window so that it can be accessed by the window's renderer process.
        settingsWindow.prefs = store.get('prefs') || {};
            
        // Load our settings page into the window.
        settingsWindow.loadFile(path.join(appPath, 'src', 'pages', 'customize.html'));
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
// Invokable IPC Handlers
// ====================================================================================================================

// Returns the execution path of this application.
ipcMain.handle('get-appPath', () => {
    return app.getAppPath();
});

// Returns the platform that this application is running on.
ipcMain.handle('get-platform', () => {
    return process.platform;
});

// Returns an object representing the user's current settings store.
ipcMain.handle('get-user-prefs', () => {
    return store.get('prefs') || {};
});

// Returns a bool indicating whether this application is registered to start automatically at logon.
ipcMain.handle('get-start-automatically', async () => {
    let autoLaunch = new AutoLaunch({name: constants.APPLICATION_NAME, path: app.getPath('exe')})
    return await autoLaunch.isEnabled();
});

// Returns the current zoom level of this this application's main window.
ipcMain.handle('get-zoom-level', () => {
    return win.webContents.getZoomLevel();
});

// ====================================================================================================================
// Settings Window Event Handlers
// ====================================================================================================================

// Asked (synchronously) by the main window's preload script at the start of every page load: returns the theme CSS
// to apply before first paint, or null when the page should stay unthemed (start-up / sign-in pages, default theme).
ipcMain.on('get-early-theme-css', (event, href) => {
    let css = null;
    try {
        const theme = process.env.GV_THEME || store.get('prefs.theme') || constants.DEFAULT_SETTING_THEME;
        if (theme !== 'default' && /^https:\/\/voice\.google\.com\/u\/\d+(\/|$)/.test(href || '')) {
            css = CSSInjector.themeCss(app, theme);
        }
    } catch (e) { console.log(e); }
    event.returnValue = css;
});

// The Settings page reports how tall its tallest tab is; grow the window to fit (never smaller than the default,
// never taller than the screen) so no tab needs scrolling.
ipcMain.on('settings-fit-height', (event, height) => {
    if (!settingsWindow || settingsWindow.isDestroyed() || !(height > 0)) { return; }
    const area = require('electron').screen.getDisplayMatching(settingsWindow.getBounds()).workArea;
    const [width, current] = settingsWindow.getContentSize();
    const fitted = Math.min(Math.max(Math.round(height), current), area.height - 60);
    if (fitted !== current) { settingsWindow.setContentSize(width, fitted); settingsWindow.center(); }
});

// Called by the Settings page once it has applied the theme colours; only then is the window shown.
ipcMain.on('settings-ready', () => {
    if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.isVisible()) { settingsWindow.show(); }
});

// Called when the theme has been changed.
ipcMain.on('pref-change-theme', (event, theme) => {
    console.log(`Theme changed to: ${theme}`);

    // Apply the selected them and then save the selection to the user's settings store.
    const pageTheme = themeForCurrentPage(theme);
    cssInjector.injectTheme(pageTheme);
    accountMenuTheme.apply(win, themePalette.get(appPath, theme));
    const prefs = store.get('prefs') || {};
    prefs.theme = theme;
    store.set('prefs', prefs);
});

// Called when the zoom level has been changed.
ipcMain.on('pref-change-zoom', (event, zoomLevel) => {
    console.log(`Zoom level changed to: ${zoomLevel}`);
    
    // Apply the newly selected zoom level.  Note that there is no need to save this setting to
    // the user's settings store.  Electron handles remembering our main window's zoom level by
    // default, so it will automatically be restored the next time the application is launched.
    setMainZoom(parseFloat(zoomLevel));
});

// Called when the "show menu bar" checkbox has been checked/unchecked.
ipcMain.on('pref-change-show-menubar', (e, showMenuBar) => {
    console.log(`"Show menu bar changed to: ${showMenuBar}`);
    
    // Apply the new value and then save it to the user's settings store.
    win.setMenuBarVisibility(showMenuBar);
    const prefs = store.get('prefs') || {};
    prefs.showMenuBar = showMenuBar;
    store.set('prefs', prefs);
});

// Called when the "start automatically" checkbox has been checked/unchecked.
ipcMain.on('pref-change-start-automatically', (e, startAutomatically) => {
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
ipcMain.on('pref-change-start-minimized', (e, startMinimized) => {
    console.log(`"Start Minimized" changed to: ${startMinimized}`);
    
    // Apply the new value and then save it to the user's settings store.
    const prefs = store.get('prefs') || {};
    prefs.startMinimized = startMinimized;
    store.set('prefs', prefs);
});

// Called when the "spell check" checkbox has been checked/unchecked.  The window reads it when it is created,
// so it takes effect the next time the app starts.
ipcMain.on('pref-change-spellcheck', (e, enabled) => {
    const prefs = store.get('prefs') || {};
    prefs.spellcheck = !!enabled;
    store.set('prefs', prefs);
});

// Called when the "copy verification codes" checkbox has been checked/unchecked.  Off by default; codeCopy.js reads
// the setting for every message, so it takes effect immediately.
ipcMain.on('pref-change-copy-codes', (e, enabled) => {
    const prefs = store.get('prefs') || {};
    prefs.copyCodes = !!enabled;
    store.set('prefs', prefs);
});

// The icon choices for the Settings dropdown: the built-in ones, whether a custom picture exists, and the one in use.
ipcMain.handle('get-icon-sets', () => ({ sets: iconSets.list(), current: icons.id, hasCustom: hasCustomIcon(), customFile: hasCustomIcon() ? customIconFile() : null }));

// Called when a different "App icon" is picked.  Applies at once and is remembered for next time.
ipcMain.on('pref-change-app-icon', (e, id) => {
    if (!iconSets.has(id) && !(id === 'custom' && hasCustomIcon())) { return; }
    const prefs = store.get('prefs') || {};
    prefs.appIcon = id;
    store.set('prefs', prefs);
    applyIconSet(id);
});

// "Choose your own image...": shows a file picker; a usable picture is saved and applied.  Answers 'ok', 'cancelled'
// or 'not-an-image'.
ipcMain.handle('pick-custom-icon', async (e) => {
    const result = await customIcon.pick(BrowserWindow.fromWebContents(e.sender), customIconFile());
    if (result === 'ok') {
        const prefs = store.get('prefs') || {};
        prefs.appIcon = 'custom';
        store.set('prefs', prefs);
        applyIconSet('custom');
    }
    return result;
});

// Called when the "check for updates" checkbox has been checked/unchecked.
ipcMain.on('pref-change-check-updates', (e, enabled) => {
    const prefs = store.get('prefs') || {};
    prefs.checkForUpdates = !!enabled;
    store.set('prefs', prefs);
});

// Called when the "exit on close" checkbox has been checked/unchecked.
ipcMain.on('pref-change-exit-on-close', (e, exitOnClose) => {
    console.log(`"Exit on close" changed to: ${exitOnClose}`);
    
    // Apply the new value and then save it to the user's settings store.
    const prefs = store.get('prefs') || {};
    prefs.exitOnClose = exitOnClose;
    store.set('prefs', prefs);
});

// Asked (synchronously) by the preload script at the start of every page load, so that the sidebar is already collapsed
// before the page first draws.
ipcMain.on('get-collapse-side-nav', (event) => {
    event.returnValue = { collapse: !!store.get('prefs.collapseSideNav'), hover: !!store.get('prefs.hoverSideNav') };
});

// Called when the "show sidebar on hover" checkbox has been checked/unchecked.
ipcMain.on('pref-change-hover-side-nav', (e, hover) => {
    const prefs = store.get('prefs') || {};
    prefs.hoverSideNav = !!hover;
    store.set('prefs', prefs);
    sideNav.setHover(win, prefs.hoverSideNav);
});

// Called when the "collapse sidebar" checkbox has been checked/unchecked.  Collapses (or re-opens) it right away.
ipcMain.on('pref-change-collapse-side-nav', (e, collapse) => {
    const prefs = store.get('prefs') || {};
    prefs.collapseSideNav = !!collapse;
    store.set('prefs', prefs);
    sideNav.setCollapsed(win, prefs.collapseSideNav);
});

// Called when the "hide dialer sidebar" checkbox has been checked/unchecked.
ipcMain.on('pref-change-hide-dialer-sidebar', (e, hideDialerSidebar) => {
    console.log(`Hide dialer sidebar changed to: ${hideDialerSidebar}`);
    
    // Apply the new value and then save it to the user's settings store.
    const prefs = store.get('prefs') || {};
    prefs.hideDialerSidebar = hideDialerSidebar;

    cssInjector.showHideDialerSidebar(hideDialerSidebar);
    store.set('prefs', prefs);
});

// Which top-bar items are hidden.  Older versions only had a "hide Upgrade" checkbox, so honour that until the user
// has chosen items with the new editor.
function hiddenTopBarItems() {
    const prefs = store.get('prefs') || {};
    if (Array.isArray(prefs.hiddenTopBarItems)) { return prefs.hiddenTopBarItems; }
    return prefs.hideUpgradeButton ? ['upgrade'] : [];
}

// Which top-bar items exist on this account's page (null = unknown), so Settings can grey out the ones that don't.
ipcMain.handle('get-topbar-present', () => topBar.present(win));

// The top-bar picture in Settings: save which items are hidden and apply it to the open page straight away.
ipcMain.on('pref-change-topbar-hidden', (e, keys) => {
    if (!Array.isArray(keys)) { return; }
    const hidden = keys.filter((k) => typeof k === 'string');
    const prefs = store.get('prefs') || {};
    prefs.hiddenTopBarItems = hidden;
    delete prefs.hideUpgradeButton;
    store.set('prefs', prefs);
    topBar.apply(win, hidden);
});

// Unread count pushed by the page the moment it changes.
ipcMain.on('gv-unread', (e, count) => {
    if (Number.isFinite(count)) { processNotificationCount(app, count); }
});

// Colours of the selected theme, so the Settings window can match it.
ipcMain.handle('get-theme-palette', (e, theme) => themePalette.get(appPath, theme || store.get('prefs.theme')));
// The colours of several themes at once, for the swatches in the Settings window (null = no colours known, e.g. Default).
ipcMain.handle('get-theme-palettes', (e, ids) => {
    const out = {};
    (Array.isArray(ids) ? ids : []).forEach((id) => { if (typeof id === 'string') { out[id] = themePalette.get(appPath, id); } });
    return out;
});
(async function() {
    const { ipcRenderer } = require('electron');
    const constants = require('../constants')

    // Allow the user to hit the Escape key to close the window.
    window.addEventListener('keyup', (event) => {
        if (event.code === 'Escape') {
            window.close();
        }
    }, true);
    
    // Retrieve the user's settings store from the main process.
    const prefs = await ipcRenderer.invoke('get-user-prefs');

    // Match this window to the selected theme (see the "themed" rules in customize.css).
    const applyPalette = async (theme) => {
        let pal = null;
        try { pal = await ipcRenderer.invoke('get-theme-palette', theme); } catch (e) { /* older main process: just keep the normal look */ }
        const root = document.documentElement;
        const vars = { '--gv-bg': 'bg', '--gv-backdrop': 'backdrop', '--gv-surface': 'surface', '--gv-fg': 'fg',
                       '--gv-subtext': 'subtext', '--gv-primary': 'primary', '--gv-on-primary': 'onPrimary', '--gv-outline': 'outline' };
        if (!pal) {
            document.body.classList.remove('themed');
            Object.keys(vars).forEach((name) => root.style.removeProperty(name));
            root.style.removeProperty('color-scheme');
            return;
        }
        Object.keys(vars).forEach((name) => root.style.setProperty(name, pal[vars[name]]));
        root.style.setProperty('color-scheme', pal.scheme);
        document.body.classList.add('themed');
    };
    await applyPalette(prefs.theme || constants.DEFAULT_SETTING_THEME);
    // The window starts hidden; now that it is themed, ask the main process to show it.

    // "Theme": a Dark/Light switch plus one swatch per colour, each drawn in that theme's own colours.  The M3 colours come
    // in a dark and a light version (ids like "m3-rose-dark"); the switch chooses which one the swatches stand for.  The
    // classic themes have just one version.  Picking a swatch applies it at once and tells the main process.
    const M3_COLOURS = [['pumpkin', 'Pumpkin'], ['github', 'GitHub'], ['atom-one', 'Atom One'], ['rose', 'Rose'],
                        ['sepia', 'Sepia'], ['green', 'Green'], ['navy', 'Navy']];
    const CLASSIC_THEMES = [['dracula', 'Dracula'], ['solar', 'Solar'], ['minty', 'Minty'], ['cerulean', 'Cerulean'], ['darkplus', 'DarkPlus']];
    const themeGrid = document.getElementById('theme-grid');
    const themeNameLabel = document.getElementById('theme-name');
    const modeButtons = Array.from(document.querySelectorAll('#mode-switch button'));
    const allThemeIds = ['default'].concat(CLASSIC_THEMES.map((t) => t[0]),
        ...M3_COLOURS.map((c) => ['m3-' + c[0] + '-dark', 'm3-' + c[0] + '-light']));
    let selectedTheme = prefs.theme || constants.DEFAULT_SETTING_THEME;
    let palettes = {};
    try { palettes = await ipcRenderer.invoke('get-theme-palettes', allThemeIds); } catch (e) { /* older main process: plain swatches */ }
    const isLightColour = (c) => {
        const m = /^#([0-9a-f]{6})$/i.exec(c || '');
        if (!m) { return null; }
        const n = parseInt(m[1], 16);
        return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 140;
    };
    let mode = 'dark';
    if (/^m3-.*-light$/.test(selectedTheme)) { mode = 'light'; }
    else if (!/^m3-.*-dark$/.test(selectedTheme)) {
        const pal = palettes[selectedTheme];
        mode = (!pal && selectedTheme === 'default') || (pal && isLightColour(pal.bg)) ? 'light' : 'dark';
    }
    const m3Id = (name) => 'm3-' + name + '-' + mode;
    const themeLabel = (id) => {
        if (id === 'default') { return 'Default'; }
        const m = /^m3-(.*)-(dark|light)$/.exec(id);
        if (m) { const c = M3_COLOURS.find((x) => x[0] === m[1]); return (c ? c[1] : m[1]) + ' (' + (m[2] === 'dark' ? 'Dark' : 'Light') + ')'; }
        const t = CLASSIC_THEMES.find((x) => x[0] === id);
        return t ? t[1] : id;
    };
    // The name beside the "Theme" label follows the mouse (or keyboard focus); it goes back to the chosen theme's name after.
    const showThemeName = (id) => { themeNameLabel.textContent = '\u2013 ' + themeLabel(id); };
    themeGrid.addEventListener('mouseover', (e) => { const b = e.target.closest('.theme-swatch'); if (b) { showThemeName(b.dataset.id); } });
    themeGrid.addEventListener('focusin', (e) => { const b = e.target.closest('.theme-swatch'); if (b) { showThemeName(b.dataset.id); } });
    themeGrid.addEventListener('mouseleave', () => showThemeName(selectedTheme));
    themeGrid.addEventListener('focusout', () => showThemeName(selectedTheme));
    const swatch = (id) => {
        const pal = palettes[id] || { bg: '#ffffff', fg: '#212529', primary: '#1a73e8' };   // Default (or unreadable): plain light
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'theme-swatch' + (id === selectedTheme ? ' selected' : '');
        b.setAttribute('aria-label', themeLabel(id));
        b.setAttribute('aria-pressed', String(id === selectedTheme));
        b.dataset.id = id;
        b.style.backgroundColor = pal.bg;
        b.style.color = pal.fg;
        const aa = document.createElement('span');
        aa.className = 'swatch-text';
        aa.textContent = 'Aa';
        const dot = document.createElement('span');
        dot.className = 'swatch-dot';
        dot.style.backgroundColor = pal.primary;
        b.appendChild(aa);
        b.appendChild(dot);
        return b;
    };
    const renderThemes = () => {
        themeGrid.textContent = '';
        modeButtons.forEach((b) => { b.classList.toggle('selected', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
        const row = document.createElement('div');
        row.className = 'swatch-row';
        row.appendChild(swatch('default'));
        M3_COLOURS.forEach(([name]) => row.appendChild(swatch(m3Id(name))));
        themeGrid.appendChild(row);
        const h = document.createElement('div');
        h.className = 'theme-group-label';
        h.textContent = 'Classic';
        themeGrid.appendChild(h);
        const row2 = document.createElement('div');
        row2.className = 'swatch-row';
        CLASSIC_THEMES.forEach(([id]) => row2.appendChild(swatch(id)));
        themeGrid.appendChild(row2);
        showThemeName(selectedTheme);
    };
    const chooseTheme = (id) => {
        selectedTheme = id;
        renderThemes();
        ipcRenderer.send('pref-change-theme', id);
        applyPalette(id);
    };
    themeGrid.addEventListener('click', (e) => {
        const b = e.target.closest('.theme-swatch');
        if (b) { chooseTheme(b.dataset.id); }
    });
    modeButtons.forEach((btn) => btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        const m = /^m3-(.*)-(dark|light)$/.exec(selectedTheme);
        if (m) { chooseTheme(m3Id(m[1])); } else { renderThemes(); }   // a classic theme stays; only the swatches change
    }));
    renderThemes();
    
    // Set the "zoom" slider to the main window's current zoom level.
    // Notify the main process whenever the user selects a new level.
    const zoomSlider = document.getElementById('zoom');
    // Electron zoom "levels" are logarithmic (each step is 1.2x, level 0 = 100%), so convert
    // to and from a plain percentage that the user can type.
    const levelToPercent = (level) => Math.round(Math.pow(1.2, level) * 100);
    const percentToLevel = (percent) => Math.log(percent / 100) / Math.log(1.2);
    zoomSlider.value = levelToPercent(await ipcRenderer.invoke('get-zoom-level'));
    zoomSlider.addEventListener('change', (e) => {
        let percent = parseFloat(e.target.value);
        if (isNaN(percent)) {
            percent = 100;
        }
        percent = Math.min(500, Math.max(25, Math.round(percent)));
        zoomSlider.value = percent;
        ipcRenderer.send('pref-change-zoom', percentToLevel(percent));
    });

    // The zoom keys (Cmd/Ctrl + - 0) change the main window, so keep the box in step with them.
    ipcRenderer.on('zoom-level-changed', (e, level) => {
        if (document.activeElement !== zoomSlider) { zoomSlider.value = levelToPercent(level); }
    });

    // Whenever the user clicks the "reset zoom" button, set the zoom
    // box back to 100 and notify the main process of this new value.
    const zoomResetButton = document.getElementById('reset-zoom');
    zoomResetButton.addEventListener('click', (e) => {
        zoomSlider.value = 100;
        ipcRenderer.send('pref-change-zoom', 0);
    });
    
    // The menus are in the title bar (Windows/Linux) or the system menu bar (Mac), so there is no "show menu bar" setting.
    document.getElementById('show-menubar-div').remove();

    // Set the "start automatically" checkbox based on the user's currently selected
    // preference.  Notify the main process whenever the preference changes.
    const startAutomatically = document.getElementById('start-automatically');
    startAutomatically.checked = await ipcRenderer.invoke('get-start-automatically');
    startAutomatically.addEventListener('change', (e) => {
        const checked = e.target.checked;
        ipcRenderer.send('pref-change-start-automatically', checked);
    });

    // Set the "start minimized" checkbox based on the user's currently selected
    // startup mode.  Notify the main process whenever the user changes the mode.
    const minimizedSetting = document.getElementById('start-minimized');
    minimizedSetting.checked = (prefs.startMinimized != undefined) ? prefs.startMinimized : constants.DEFAULT_SETTING_START_MINIMIZED;
    minimizedSetting.addEventListener('change', (e) => {
        const checked = e.target.checked;
        ipcRenderer.send('pref-change-start-minimized', checked);
    });

    // Set the "exit on close" checkbox based on the user's currently selected
    // preference.  Notify the main process whenever the preference changes.
    const exitOnCloseSetting = document.getElementById('exit-on-close');
    exitOnCloseSetting.checked = (prefs.exitOnClose != undefined) ? prefs.exitOnClose : constants.DEFAULT_SETTING_EXIT_ON_CLOSE;
    exitOnCloseSetting.addEventListener('change', (e) => {
        const checked = e.target.checked;
        ipcRenderer.send('pref-change-exit-on-close', checked);
    });

    // Set the "hide dialer sidebar" checkbox based on the user's currently selected
    // preference.  Notify the main process whenever the preference changes.
    const hideDialerSidebar = document.getElementById('hide-dialer-sidebar');
    hideDialerSidebar.checked = (prefs.hideDialerSidebar != undefined) ? prefs.hideDialerSidebar : constants.DEFAULT_HIDE_DIALER_SIDEBAR;
    hideDialerSidebar.addEventListener('change', (e) => {
        const checked = e.target.checked;
        ipcRenderer.send('pref-change-hide-dialer-sidebar', checked);
    });

    // Set the "collapse sidebar" checkbox (off by default); it takes effect immediately.
    const collapseSideNav = document.getElementById('collapse-side-nav');
    collapseSideNav.checked = !!prefs.collapseSideNav;
    // "Show it when hovering" only makes sense while the sidebar is collapsed.
    const hoverSideNav = document.getElementById('hover-side-nav');
    hoverSideNav.checked = !!prefs.hoverSideNav;
    hoverSideNav.disabled = !collapseSideNav.checked;
    collapseSideNav.addEventListener('change', (e) => {
        hoverSideNav.disabled = !e.target.checked;
        ipcRenderer.send('pref-change-collapse-side-nav', e.target.checked);
    });
    hoverSideNav.addEventListener('change', (e) => {
        ipcRenderer.send('pref-change-hover-side-nav', e.target.checked);
    });

    // Set the "spell check" checkbox; the main process applies it the next time the app starts.
    const spellcheck = document.getElementById('spellcheck');
    spellcheck.checked = prefs.spellcheck !== false;
    spellcheck.addEventListener('change', (e) => {
        ipcRenderer.send('pref-change-spellcheck', e.target.checked);
    });

    // "App icon": a grid of pictures (the built-in icons, "Your image" once one has been chosen, and a "+" tile that opens
    // the file picker).  Applies immediately.
    try {
        const first = await ipcRenderer.invoke('get-icon-sets');
        if (first.sets.length > 1) {
            const grid = document.getElementById('app-icon-grid');
            const nameLabel = document.getElementById('app-icon-name');
            let selected = first.current;
            let customUrl = first.customFile ? require('url').pathToFileURL(first.customFile).href + '?v=' + Date.now() : null;
            const labels = {};
            first.sets.forEach((s) => { labels[s.id] = s.label; });
            labels.custom = 'Your image';
            labels.__choose__ = 'Choose your own image\u2026';
            // The name beside the "App icon" label follows the mouse (or keyboard focus), then goes back to the chosen icon's name.
            const showName = (id) => { nameLabel.textContent = '\u2013 ' + (labels[id] || ''); };
            const tile = (id, title, src) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'icon-tile';
                b.setAttribute('aria-label', title);
                b.dataset.id = id;
                if (src) { const img = document.createElement('img'); img.src = src; img.alt = ''; b.appendChild(img); }
                return b;
            };
            const render = () => {
                grid.textContent = '';
                first.sets.forEach((s) => grid.appendChild(tile(s.id, s.label, '../../images/' + s.preview)));
                if (customUrl) { grid.appendChild(tile('custom', 'Your image', customUrl)); }
                const plus = tile('__choose__', 'Choose your own image\u2026');
                plus.classList.add('icon-tile-plus');
                plus.textContent = '+';
                grid.appendChild(plus);
                grid.querySelectorAll('.icon-tile').forEach((b) => {
                    const on = b.dataset.id === selected;
                    b.classList.toggle('selected', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                showName(selected);
            };
            grid.addEventListener('mouseover', (e) => { const b = e.target.closest('.icon-tile'); if (b) { showName(b.dataset.id); } });
            grid.addEventListener('focusin', (e) => { const b = e.target.closest('.icon-tile'); if (b) { showName(b.dataset.id); } });
            grid.addEventListener('mouseleave', () => showName(selected));
            grid.addEventListener('focusout', () => showName(selected));
            grid.addEventListener('click', async (e) => {
                const b = e.target.closest('.icon-tile');
                if (!b) { return; }
                const id = b.dataset.id;
                if (id !== '__choose__') { selected = id; render(); ipcRenderer.send('pref-change-app-icon', id); return; }
                const result = await ipcRenderer.invoke('pick-custom-icon');
                if (result === 'ok') {
                    const now = await ipcRenderer.invoke('get-icon-sets');
                    customUrl = now.customFile ? require('url').pathToFileURL(now.customFile).href + '?v=' + Date.now() : null;
                    selected = 'custom';
                    render();
                } else if (result === 'not-an-image') {
                    window.alert('That file could not be used as an icon. Try a PNG or JPG, or an icon file (.icns on a Mac, .ico on Windows).');
                }
            });
            render();
            document.getElementById('app-icon-group').style.display = '';
        }
    } catch (e) { /* older main process: no icon choice */ }

    // Set the "copy verification codes" checkbox (off by default); it takes effect immediately.
    const copyCodes = document.getElementById('copy-codes');
    if (process.platform === 'win32') { document.getElementById('copy-codes-row').style.display = 'none'; }   // Windows notifications have their own Copy button
    copyCodes.checked = !!prefs.copyCodes;
    copyCodes.addEventListener('change', (e) => {
        ipcRenderer.send('pref-change-copy-codes', e.target.checked);
    });

    // Set the "tell me about updates" checkbox (on by default).
    const checkUpdates = document.getElementById('check-updates');
    checkUpdates.checked = prefs.checkForUpdates !== false;
    checkUpdates.addEventListener('change', (e) => {
        ipcRenderer.send('pref-change-check-updates', e.target.checked);
    });

    // "Top bar": a picture of Google Voice's top bar.  Clicking an item hides or shows it (applied to the main window at once).
    // The keys and their order match src/utils/topBar.js.
    // Headphones, like the audio button on the Google Voice page (a fixed drawing, not page content).
    const HEADPHONES_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>';
    const TOPBAR_ITEMS = [
        { key: 'menu',     label: 'Menu',            text: '\u2630' },
        { key: 'logo',     label: 'Voice logo',      text: 'Voice' },
        { key: 'search',   label: 'Search',          text: 'Search', wide: true },
        { key: 'status',   label: 'Receiving calls', text: 'Receiving calls' },
        { key: 'upgrade',  label: 'Upgrade',         text: 'Upgrade' },
        { key: 'audio',    label: 'Audio settings',  text: '', icon: HEADPHONES_SVG },
        { key: 'help',     label: 'Help',            text: '?' },
        { key: 'settings', label: 'Settings',        text: '\u2699' },
        { key: 'apps',     label: 'Google apps',     text: '\u25A6' },
        { key: 'account',  label: 'Account',         text: '\u25CF' }
    ];
    const hiddenBar = new Set(Array.isArray(prefs.hiddenTopBarItems) ? prefs.hiddenTopBarItems : (prefs.hideUpgradeButton ? ['upgrade'] : []));
    let barPresent = null;   // keys of the items that exist on this account's page; null = unknown (then nothing is greyed out)
    try { barPresent = await ipcRenderer.invoke('get-topbar-present'); } catch (e) { /* older main process */ }
    const barAbsent = (key) => Array.isArray(barPresent) && !barPresent.includes(key);
    const barMock = document.getElementById('topbar-mock');
    const barCaption = document.getElementById('topbar-caption');
    const barSummary = () => {
        const names = TOPBAR_ITEMS.filter((i) => hiddenBar.has(i.key) && !barAbsent(i.key)).map((i) => i.label);
        barCaption.textContent = names.length ? 'Hidden: ' + names.join(', ') : 'Click an item to hide or show it. Nothing is hidden.';
    };
    const renderBar = () => {
        barMock.textContent = '';
        TOPBAR_ITEMS.forEach((item) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tb-chip' + (item.wide ? ' tb-wide' : '') + (hiddenBar.has(item.key) && !barAbsent(item.key) ? ' tb-hidden' : '') + (barAbsent(item.key) ? ' tb-absent' : '');
            if (barAbsent(item.key)) { b.setAttribute('aria-disabled', 'true'); }   // not the disabled attribute: that would stop the hover caption
            if (item.icon) { b.innerHTML = item.icon; } else { b.textContent = item.text; }
            b.dataset.key = item.key;
            b.setAttribute('aria-label', item.label);
            b.setAttribute('aria-pressed', String(!hiddenBar.has(item.key)));
            barMock.appendChild(b);
        });
        barSummary();
    };
    const saveBar = () => { renderBar(); ipcRenderer.send('pref-change-topbar-hidden', Array.from(hiddenBar)); };
    const barItemFor = (e) => { const b = e.target.closest('.tb-chip'); return b ? TOPBAR_ITEMS.find((i) => i.key === b.dataset.key) : null; };
    const barHover = (e) => { const item = barItemFor(e); if (item) { barCaption.textContent = barAbsent(item.key) ? item.label + ' \u2013 not on your page' : item.label + (hiddenBar.has(item.key) ? ' \u2013 hidden (click to show)' : ' \u2013 shown (click to hide)'); } };
    barMock.addEventListener('click', (e) => {
        const item = barItemFor(e);
        if (!item || barAbsent(item.key)) { return; }
        if (hiddenBar.has(item.key)) { hiddenBar.delete(item.key); } else { hiddenBar.add(item.key); }
        saveBar();
    });
    barMock.addEventListener('mouseover', barHover);
    barMock.addEventListener('focusin', barHover);
    barMock.addEventListener('mouseleave', barSummary);
    barMock.addEventListener('focusout', barSummary);
    document.getElementById('topbar-show-all').addEventListener('click', () => { hiddenBar.clear(); saveBar(); });
    renderBar();

    // Tabs: "General" and "Appearance" show one group of settings each.
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('selected', b === btn));
            document.querySelectorAll('.tab-panel').forEach((panel) => { panel.style.display = panel.id === 'tab-' + btn.dataset.tab ? '' : 'none'; });
        });
    });

    // Close the window if the user clicks the "Close" button.
    const closeButton = document.getElementById('close-button');
    closeButton.addEventListener('click', (e) => {
        window.close();
    });

    // Size the window to fit the tallest tab, so no tab needs scrolling, then ask the main process to show it.
    {
        const row = document.getElementById('first-row');
        let tallest = 0;
        document.querySelectorAll('.tab-panel').forEach((panel) => {
            const was = panel.style.display;
            panel.style.display = '';
            tallest = Math.max(tallest, panel.offsetHeight);
            panel.style.display = was;
        });
        ipcRenderer.send('settings-fit-height', Math.ceil(window.innerHeight - row.clientHeight + tallest + 8));
        requestAnimationFrame(() => requestAnimationFrame(() => ipcRenderer.send('settings-ready')));
    }
})();
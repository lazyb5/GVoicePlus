const fs = require('fs');
const path = require('path');

const THEMES_DIR = ['src', 'themes'];
const SHARED = ['base.scss', 'mappings.scss', 'm3.scss'];   // pieces that every theme is built from
const HIDE_DIALER_SIDEBAR_CSS = `gv-call-sidebar { display: none }`;

// Sass is only needed to (re)build a theme's CSS, so it is loaded the first time that happens and never in a packaged
// build, where the CSS is compiled ahead of time (scripts/build-themes.js).  That keeps ~4 MB of JavaScript, and the
// time to compile on every page load, out of the running app.
let sass = null;
const getSass = () => sass || (sass = require('sass'));

const themesDir = (app) => path.join(app.getAppPath(), ...THEMES_DIR);
const compiledPath = (app, theme) => path.join(themesDir(app), 'compiled', `${theme}.css`);
const mtime = (file) => { try { return fs.statSync(file).mtimeMs; } catch (e) { return 0; } };

/**
 * The way sass processes use functions just isn't good enough, we need variables that can scope across files and we also
 * need to be able to split our selectors and placeholder selectors into different files for neatness. Anyway this is just a
 * simple function to recombine multiple files and then let sass process that
 */
function joinImports(dir, file) {
    const read = (name) => fs.readFileSync(path.join(dir, name), 'utf-8');
    let contents = file.replace("@use 'base';", read('base.scss'));
    contents = contents.replace("@use 'mappings';", read('mappings.scss'));
    // Only the m3-*.scss themes ask for this; it must come after base so its rules win.
    if (contents.includes("@use 'm3';")) { contents = contents.replace("@use 'm3';", read('m3.scss')); }
    return contents;
}

function compileTheme(dir, theme) {
    const file = fs.readFileSync(path.join(dir, `${theme}.scss`), 'utf-8');
    const result = getSass().renderSync({ data: joinImports(dir, file) });
    return result.css.toString().replace(/;/g, ' !important;');
}

/**
 * Returns the finished CSS for a theme.  Order of preference:
 *   1. the precompiled file (always, in a packaged app; in development only if it is newer than every source file),
 *   2. compiling the .scss now, then saving the result so the next run can use (1).
 * Results are also kept in memory, because this runs on every page load.
 */
const memory = new Map();
function themeCss(app, theme) {
    const dir = themesDir(app);
    const compiled = compiledPath(app, theme);
    const sourcesNewest = Math.max(mtime(path.join(dir, `${theme}.scss`)), ...SHARED.map((f) => mtime(path.join(dir, f))));
    const key = `${theme}:${app.isPackaged ? 'packaged' : sourcesNewest}`;
    if (memory.has(key)) { return memory.get(key); }

    let css;
    if (fs.existsSync(compiled) && (app.isPackaged || mtime(compiled) >= sourcesNewest)) {
        css = fs.readFileSync(compiled, 'utf-8');
    } else {
        css = compileTheme(dir, theme);
        try { fs.mkdirSync(path.dirname(compiled), { recursive: true }); fs.writeFileSync(compiled, css); } catch (e) { /* read-only: fine */ }
    }
    memory.set(key, css);
    return css;
}

class Injector {
    constructor(app, win) {
        this.win = win;
        this.app = app;
    }

    showHideDialerSidebar(hide) {
        if (!this.win) return;

        if (hide) {
            this.win.webContents.insertCSS(HIDE_DIALER_SIDEBAR_CSS).then(key => {
                this.sidebarStyleKey = key;
            });
        } else {
            if (this.sidebarStyleKey) {
                this.win.webContents.removeInsertedCSS(this.sidebarStyleKey);
            }
        }
    }

    injectTheme(theme) {
        if (this.styleKey) {
            this.win.webContents.removeInsertedCSS(this.styleKey);
            this.styleKey = null;
        }

        let done = Promise.resolve();
        if (theme !== 'default') {
            try {
                const styles = themeCss(this.app, theme);
                if (this.win) {
                    done = this.win.webContents.insertCSS(styles).then(key => {
                        this.styleKey = key;
                    });
                }
            } catch (e) {
                console.log(e);
                console.error(`Could not find theme ${theme}`);
            }
        }
        return done;   // resolves once the theme is actually in the page
    }
}

module.exports = Injector;
module.exports.themeCss = themeCss;
module.exports.compileTheme = compileTheme;   // used by scripts/build-themes.js

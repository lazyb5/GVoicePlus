#!/usr/bin/env node
/**
 * Compiles every theme (src/themes/<name>.scss) to ready-to-inject CSS in src/themes/compiled/<name>.css.
 * A packaged app ships these files instead of Sass, which is why it starts leaner and applies a theme without compiling.
 * Runs automatically before every `npm run build:*`; run it by hand with `npm run build:themes`.
 */
const fs = require('fs');
const path = require('path');
const { compileTheme } = require('../src/utils/cssInjector');

const dir = path.join(__dirname, '..', 'src', 'themes');
const out = path.join(dir, 'compiled');
const SHARED = ['base.scss', 'mappings.scss', 'm3.scss'];

fs.mkdirSync(out, { recursive: true });
const themes = fs.readdirSync(dir).filter((f) => f.endsWith('.scss') && !SHARED.includes(f)).map((f) => f.replace(/\.scss$/, ''));

let bytes = 0;
themes.forEach((theme) => {
    const css = compileTheme(dir, theme);
    fs.writeFileSync(path.join(out, `${theme}.css`), css);
    bytes += css.length;
});
console.log(`build-themes: compiled ${themes.length} themes (${Math.round(bytes / 1024)} KB) into src/themes/compiled/`);

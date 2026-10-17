#!/usr/bin/env node
/**
 * Generates src/themes/m3-<scheme>.scss from M3 Vibrant's color.ini (https://github.com/luoshenshi/M3-Vibrant,
 * MIT licence, (c) 2026 Kenzx; a copy of the palette and licence is in src/themes/m3-vibrant/).
 * Edit this script (or src/themes/m3.scss for the look), not the generated files.
 *
 *   node scripts/generate-m3-themes.js [path/to/color.ini]
 */
const fs = require('fs');
const path = require('path');

const iniPath = process.argv[2] || path.join(__dirname, '..', 'src', 'themes', 'm3-vibrant', 'color.ini');
const outDir = path.join(__dirname, '..', 'src', 'themes');

const parseIni = (text) => {
    const sections = {};
    let cur = null;
    text.split(/\r?\n/).forEach((line) => {
        const s = line.match(/^\[(.+)\]\s*$/);
        if (s) { cur = sections[s[1]] = {}; return; }
        const kv = line.match(/^\s*([\w-]+)\s*=\s*#?([0-9a-fA-F]{6})\b/);
        if (kv && cur) { cur[kv[1]] = kv[2].toLowerCase(); }
    });
    return sections;
};

const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, pct) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v * pct + y[i] * (1 - pct))); };
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const onColor = (bg) => {
    const best = contrast('ffffff', bg) >= contrast('1a1a1a', bg) ? 'ffffff' : '1a1a1a';
    // Mid-tone accents can fail AA with either; pure black is the last resort (only chosen when it is actually better).
    return '#' + ((contrast(best, bg) < 4.5 && contrast('000000', bg) > contrast(best, bg)) ? '000000' : best);
};

// Light schemes ship an accent colour as their "text" (pink, orange, green...), which is too faint on their own tinted
// surfaces.  Keep its hue but darken it until it reads at WCAG AA (4.5:1) on every surface the page text can sit on, even
// after the 0.8 opacity the lists apply to secondary text.  Dark schemes are left exactly as the palette defines them.
const TEXT_OPACITY = 0.9;   // light themes dim secondary text only a little ($detail-opacity below), so the tint survives
// Darkens `text` (keeping its hue) just until it reads at 4.5:1 on all of `surfaces`, even at TEXT_OPACITY.
const shadeFor = (text, surfaces) => {
    for (let keep = 1; keep >= 0; keep -= 0.02) {
        const t = mix(text, '000000', keep);
        if (surfaces.every((s) => contrast(mix(t, s, TEXT_OPACITY), s) >= 4.5)) { return t; }
    }
    return '000000';
};
// Text for the ordinary surfaces (panels, backdrop, cards).  Dark schemes keep the palette's own colour.
const readableText = (c) => (lum(c.main) < 0.5 ? c.text : shadeFor(c.text, [c.main, c.sidebar, c.card, mix(c.card, c.main, 0.55)]));
// Text for the darker tinted surfaces (selected rows, incoming bubbles, the message box): a deeper shade of the same hue.
const onTintedText = (c) => shadeFor(c.text, [c['selected-row'], mix(c.button, c.main, 0.30)]);
// Text on the accent: white when it reads, otherwise a very dark shade of the accent itself (never a flat black).
const onAccent = (c) => {
    if (contrast('ffffff', c.button) >= 4.5) { return '#ffffff'; }
    for (let k = 0.4; k >= 0; k -= 0.05) {
        const t = mix(c.button, '000000', k);
        if (contrast(t, c.button) >= 4.5) { return '#' + t; }
    }
    return '#000000';
};

const sections = parseIni(fs.readFileSync(iniPath, 'utf8'));
const names = [];
Object.entries(sections).forEach(([name, c]) => {
    const light = lum(c.main) >= 0.5;
    const text = readableText(c), main = c.main, onTinted = onTintedText(c);
    const vars = [
        ['background', '#' + main, 'main surface (panels)'],
        ['backdrop', '#' + c.sidebar, 'outermost layer behind the panels'],
        ['foreground', '#' + text, 'text'],
        ['subtext', '#' + c.subtext, 'secondary text'],
        ['selection', '#' + c['selected-row'], 'selected row / card'],
        ['card', '#' + c.card, 'raised surface'],
        ['container-high', '#' + mix(c.card, main, 0.55), 'tonal surface between main and card'],
        ['primary', '#' + c.button, 'accent (buttons, sent bubbles)'],
        ['primary-strong', '#' + c['button-active'], 'accent, pressed'],
        ['on-primary', light ? onAccent(c) : onColor(c.button), 'text/icons on the accent'],
        ['primary-container', '#' + mix(c.button, main, 0.30), 'tinted container for active/selected states'],
        // Light schemes: a deeper shade of the theme's own text colour, so selected rows keep the theme's hue instead of going
        // black.  Dark schemes keep the white/near-black pick.
        ['on-primary-container', light ? '#' + onTinted : onColor(mix(c.button, main, 0.30)), 'text/icons on that container'],
        ['secondary', '#' + c.highlight, 'highlight'],
        ['outline', `rgba(${rgb(c.text).join(', ')}, 0.12)`, 'dividers'],
        ['color-scheme', light ? 'light' : 'dark', 'for native controls and scrollbars']
    ];
    if (light) {   // light schemes only (dark output stays exactly as it was)
        vars.push(['on-selection', '#' + onTinted, 'text on selected rows, incoming bubbles and the message box']);
        vars.push(['detail-opacity', String(TEXT_OPACITY), 'secondary text dimming (dark themes use 0.8)']);
    }
    const body = vars.map(([k, v, note]) => `$${k}: ${v};`.padEnd(40) + `// ${note}`).join('\n');
    const scss = `/* M3 Vibrant "${name}".  Palette from https://github.com/luoshenshi/M3-Vibrant (MIT, (c) 2026 Kenzx).
   GENERATED by scripts/generate-m3-themes.js: edit the generator or src/themes/m3.scss, not this file. */
${body}

@use 'base';
@use 'm3';
`;
    fs.writeFileSync(path.join(outDir, `m3-${name}.scss`), scss);
    names.push(name);
});
console.log('generated', names.length, 'themes:', names.join(', '));

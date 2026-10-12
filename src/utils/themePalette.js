/**********************************************************************************************************************
 * Reads the colours of a theme out of its .scss file (the "$background: #123456;" style variables at the top) so other
 * parts of the app, such as the Settings window, can match the selected theme.  Returns null for the default theme
 * or anything unreadable, in which case those parts just keep their normal look.
 **********************************************************************************************************************/

const fs = require('fs');
const path = require('path');

const NAMED = { white: [255, 255, 255], black: [0, 0, 0] };
const toRgb = (value) => {
    if (NAMED[String(value).toLowerCase()]) { return NAMED[String(value).toLowerCase()]; }
    let m = /^#([0-9a-f]{6})$/i.exec(value);
    if (m) { return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); }
    m = /^#([0-9a-f]{3})$/i.exec(value);
    if (m) { return m[1].split('').map((c) => parseInt(c + c, 16)); }
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
    return m ? [+m[1], +m[2], +m[3]] : null;
};
const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

module.exports.get = function (appPath, theme) {
    if (!theme || theme === 'default' || !/^[\w-]+$/.test(theme)) { return null; }
    let text;
    try { text = fs.readFileSync(path.join(appPath, 'src', 'themes', theme + '.scss'), 'utf8'); } catch (e) { return null; }

    const raw = {};
    for (const m of text.matchAll(/^\s*\$([\w-]+)\s*:\s*([^;]+);/gm)) { raw[m[1]] = m[2].trim(); }
    const vars = {};
    Object.keys(raw).forEach((k) => {   // resolve one level of "$a: $b"
        const ref = /^\$([\w-]+)$/.exec(raw[k]);
        vars[k] = ref && raw[ref[1]] ? raw[ref[1]] : raw[k];
    });

    const bg = vars.background, fg = vars.foreground;
    if (!bg || !fg || !toRgb(bg) || !toRgb(fg)) { return null; }
    const primary = vars.primary && toRgb(vars.primary) ? vars.primary : fg;
    const onPrimary = vars['on-primary'] || (contrast([255, 255, 255], toRgb(primary)) >= contrast([26, 26, 26], toRgb(primary)) ? '#ffffff' : '#1a1a1a');
    const fgRgb = toRgb(fg);
    // Only fully opaque colours are usable as surfaces (semi-transparent ones like rgba(0,0,0,.075) are overlays).
    const solid = (v) => v && toRgb(v) && !/^rgba\(.*,\s*0?\.\d+\s*\)$/i.test(v);
    const pick = (value, fallback) => (solid(value) ? value : fallback);
    const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const bgRgb = toRgb(bg);
    const tint = hex(bgRgb.map((v, i) => v * 0.9 + fgRgb[i] * 0.1));   // bg nudged 10% toward the text colour

    return {
        scheme: luminance(toRgb(bg)) < 0.5 ? 'dark' : 'light',
        bg,
        backdrop: pick(vars.backdrop, bg),
        surface: pick(vars['container-high'], solid(vars.selection) && contrast(toRgb(vars.selection), fgRgb) >= 3 ? vars.selection : tint),
        fg,
        subtext: pick(vars.subtext, fg),
        primary,
        onPrimary,
        outline: vars.outline || `rgba(${fgRgb.join(', ')}, 0.25)`
    };
};

/**********************************************************************************************************************
 * "Contrast guard": a safety net for themes.  Themes recolor text and some backgrounds using selectors for Google's
 * markup, so when Google changes that markup, light text can end up on a white background (unreadable).  After a
 * theme is applied, this scans the page and, for any text whose contrast against its actual background is too low,
 * overrides just the text color with a readable one.  It re-checks as the page changes.  It never touches
 * backgrounds, and it undoes itself when the theme changes or is set to 'default'.
 *
 * Disable for testing with:  GV_NO_GUARD=1 npm start
 **********************************************************************************************************************/

// Runs INSIDE the Google Voice page (stringified and executed there), so it must be fully self-contained.
function guardMain() {
    if (!window.__gvGuard) {
        const MARK = 'data-gv-guard';   // holds the element's previous inline color so reset() can restore it
        const THRESHOLD = 3;            // WCAG minimum for large text; only clearly unreadable text gets changed
        const SKIP = /^(SCRIPT|STYLE|SVG|PATH|IMG|CANVAS|VIDEO|NOSCRIPT|HEAD|META|LINK)$/i;
        const pending = new Set();
        let enabled = false, observer = null, timer = null, budget = 0;

        const parse = (s) => {
            if (!s || !/^rgb/.test(s)) { return null; }
            const m = s.match(/[\d.]+/g);
            return (m && m.length >= 3) ? { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 } : null;
        };
        const lum = (c) => {
            const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
            return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

        // Undo our override on one element, putting back whatever inline color it had before.
        const restore = (e) => {
            if (!e.hasAttribute(MARK)) { return; }
            const prev = e.getAttribute(MARK);
            if (prev) { e.style.setProperty('color', prev); } else { e.style.removeProperty('color'); }
            e.removeAttribute(MARK);
        };

        // The first mostly-opaque background walking up the tree.  Images/gradients: don't guess.  Nothing: white canvas.
        const effectiveBg = (el) => {
            for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
                const cs = getComputedStyle(e);
                if (cs.backgroundImage && cs.backgroundImage !== 'none') { return null; }
                const bg = parse(cs.backgroundColor);
                if (bg && bg.a > 0.6) { return bg; }
            }
            return { r: 255, g: 255, b: 255, a: 1 };
        };

        const check = (el) => {
            if (el.nodeType !== 1 || SKIP.test(el.tagName) || el.hasAttribute(MARK)) { return; }
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') { return; }
            const fg = parse(cs.color), bg = effectiveBg(el);
            if (!fg || !bg || ratio(fg, bg) >= THRESHOLD) { return; }
            el.setAttribute(MARK, el.style.getPropertyValue('color') || '');
            // Pick whichever of near-black / near-white reads better on this background.
            const useDark = ratio({ r: 31, g: 31, b: 31 }, bg) >= ratio({ r: 232, g: 232, b: 232 }, bg);
            el.style.setProperty('color', useDark ? '#1f1f1f' : '#e8e8e8', 'important');
        };

        const scan = (root) => {
            if (!root || root.nodeType !== 1) { return; }
            const seen = new Set();
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let n;
            while (budget > 0 && (n = walker.nextNode())) {
                const p = n.parentElement;
                if (p && !seen.has(p) && n.nodeValue.trim()) { seen.add(p); budget--; check(p); }
            }
            root.querySelectorAll('input,textarea').forEach(check);
            // Fields hold their text in a value, not a text node, and the root itself may be the field.
            if (/^(INPUT|TEXTAREA)$/.test(root.tagName) || root.isContentEditable) { check(root); }
        };

        const flush = () => {
            if (!enabled || document.hidden) { return; }   // nothing to do while the window is hidden; resumes when shown
            budget = 800; // cap work per pass so busy pages never stall
            const roots = Array.from(pending);
            pending.clear();
            roots.slice(0, 300).forEach((r) => { if (r.isConnected) { scan(r); } });
        };
        const schedule = () => { clearTimeout(timer); timer = setTimeout(flush, 600); };
        document.addEventListener('visibilitychange', () => { if (!document.hidden && pending.size) { schedule(); } });
        const onMutations = (records) => {
            records.forEach((rec) => {
                if (rec.type === 'childList') {
                    rec.addedNodes.forEach((nd) => {
                        if (nd.nodeType === 1) { pending.add(nd); }
                        else if (nd.nodeType === 3 && nd.parentElement) { pending.add(nd.parentElement); }
                    });
                }
            });
            schedule();
        };

        window.__gvGuard = {
            enable() {
                enabled = true;
                this.reset();
                if (!observer) {
                    observer = new MutationObserver(onMutations);
                    observer.observe(document.documentElement,
                        { childList: true, subtree: true });
                }
                // Theme CSS is inserted asynchronously, so give it a moment before the first full pass.
                setTimeout(() => { if (enabled && document.body) { budget = 5000; scan(document.body); } }, 800);
            },
            disable() {
                enabled = false;
                this.reset();
                if (observer) { observer.disconnect(); observer = null; }
            },
            reset() {
                document.querySelectorAll('[' + MARK + ']').forEach(restore);
            }
        };
    }
    window.__gvGuard.enable();
}

const SOURCE = `(${guardMain.toString()})()`;
module.exports.SOURCE = SOURCE; // exported for testing

// Starts (or restarts) the guard for the given theme, or switches it off for the 'default' theme.
module.exports.start = function (win, theme) {
    if (!win || win.isDestroyed() || process.env.GV_NO_GUARD) { return; }
    const js = (theme === 'default') ? 'window.__gvGuard && window.__gvGuard.disable()' : SOURCE;
    win.webContents.executeJavaScript(js).catch(() => {});
};

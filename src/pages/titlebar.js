// The title bar strip (Windows and Linux).  It has no Node and no Electron: window.gvTitleBar, made by
// src/titlebarPreload.js, is all it can reach.
const ok = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
const setColour = (name, value) => { if (ok(value)) { document.documentElement.style.setProperty(name, value); } };

const q = new URLSearchParams(location.search);
setColour('--bg', q.get('bg'));
setColour('--fg', q.get('fg'));
setColour('--hover', q.get('hover'));

// The main process re-sends the colours when the theme changes.
window.gvTitleBar.onColours((c) => {
    if (!c) { return; }
    setColour('--bg', c.bg);
    setColour('--fg', c.fg);
    setColour('--hover', c.hover);
});

// Clicking a label asks the main process to open the matching menu just under it.
document.querySelectorAll('.menu').forEach((btn) => {
    btn.addEventListener('click', () => {
        const r = btn.getBoundingClientRect();
        btn.classList.add('open');
        window.gvTitleBar.openMenu(Number(btn.dataset.index), r.left, r.bottom);
    });
});
window.gvTitleBar.onMenuClosed(() => {
    document.querySelectorAll('.menu.open').forEach((b) => b.classList.remove('open'));
});

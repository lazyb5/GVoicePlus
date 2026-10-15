/**********************************************************************************************************************
 * Paste an image (Cmd+V) into the message box and have it attached to the draft, like the "Add image" button does.
 * Google Voice keeps a hidden file input inside the compose area (gv-message-entry); the pasted image is handed to it
 * as if it had been picked from the file dialog.  Nothing is ever sent automatically: the image shows up as an
 * attachment and the person presses Send.
 *
 * The input only accepts JPEG, PNG, GIF and BMP.  Small images in those formats pass through untouched; anything else
 * (WebP, TIFF, ...) or anything large is redrawn on a canvas, capped at 2048 px on its longest side, and saved as JPEG.
 * Plain-text pastes are left alone.
 **********************************************************************************************************************/

// Runs INSIDE the Google Voice page (stringified and executed there), so it must be fully self-contained.
function pageImagePaste() {
    if (window.__gvImagePaste) { return; }   // already installed on this page
    const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp'];   // what Google's file input accepts
    const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp' };
    const MAX_SIDE = 2048;
    const PASS_THROUGH_BYTES = 1.5 * 1024 * 1024;
    const QUALITY = 0.85;

    const toast = (text) => {
        const old = document.getElementById('gv-image-paste-toast');
        if (old) { old.remove(); }
        const el = document.createElement('div');
        el.id = 'gv-image-paste-toast';
        el.textContent = text;
        el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 18px;' +
            'background:#323232;color:#fff;border-radius:8px;font:14px sans-serif;z-index:2147483647;' +
            'box-shadow:0 2px 8px rgba(0,0,0,.4)';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    };

    const prepare = async (file) => {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error('decode'));
                i.src = url;
            });
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            const stamp = Date.now();
            if (ACCEPTED.includes(file.type) && Math.max(w, h) <= MAX_SIDE && file.size <= PASS_THROUGH_BYTES) {
                return new File([file], 'pasted-image-' + stamp + '.' + EXT[file.type], { type: file.type });
            }
            const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(w * scale));
            canvas.height = Math.max(1, Math.round(h * scale));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';   // JPEG has no transparency
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
            if (!blob) { throw new Error('encode'); }
            return new File([blob], 'pasted-image-' + stamp + '.jpg', { type: 'image/jpeg' });
        } finally {
            URL.revokeObjectURL(url);
        }
    };

    const attach = (entry, file) => {
        // The compose area can be redrawn while the image is being prepared, so look the input up again.
        const live = entry.isConnected ? entry : document.querySelector('gv-message-entry');
        const input = live && live.querySelector('input[type="file"]');
        if (!input) { throw new Error('no input'); }
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    document.addEventListener('paste', (e) => {
        const entry = e.target && e.target.closest ? e.target.closest('gv-message-entry') : null;
        if (!entry) { return; }   // only pastes into the message box
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) { return; }
        let file = null;
        for (const item of items) {
            if (item.kind === 'file' && item.type.indexOf('image/') === 0) { file = item.getAsFile(); break; }
        }
        if (!file) { return; }   // text paste: leave it alone
        if (!entry.querySelector('input[type="file"]')) { return; }   // Google's markup changed: don't swallow the paste
        e.preventDefault();
        e.stopPropagation();
        prepare(file)
            .then((f) => attach(entry, f))
            .catch(() => toast('Could not attach the pasted image'));
    }, true);

    window.__gvImagePaste = { prepare };   // exposed for testing
}

const SOURCE = `(${pageImagePaste.toString()})();`;
module.exports.SOURCE = SOURCE;   // exported for testing

// Installs the paste handler in the main window (safe to call on every page load).
module.exports.start = function (win) {
    if (!win || win.isDestroyed()) { return; }
    win.webContents.executeJavaScript(SOURCE).catch(() => {});
};

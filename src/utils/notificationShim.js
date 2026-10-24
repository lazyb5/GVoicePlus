/**********************************************************************************************************************
 * Replaces the page's "Notification" class with a stand-in that forwards each notification to the main process,
 * where it is shown as a native Electron notification with an inline reply field (macOS).  Clicks are relayed
 * back so the page's own handlers still run.
 *
 * This function runs inside Google's page (its own JavaScript world), NOT in the preload script, so it has no access to
 * Node or Electron.  preload.js injects its source with webFrame.executeJavaScript and hands it `bridge`, a small object
 * made with contextBridge (notify / close / onClick).  Keep it self-contained: it must not refer to anything outside
 * itself, because only the function's text is injected.
 **********************************************************************************************************************/

module.exports.notificationShim = function (bridge) {
    const OldNotification = window.Notification;
    const live = new Map();
    let nextId = 1;

    class ShimNotification extends EventTarget {
        constructor(title, options = {}) {
            super();
            this.title = String(title);
            this.body = options.body || '';
            this.tag = options.tag || '';
            this.data = options.data;
            this.onclick = null;
            this.onclose = null;
            this._id = nextId++;

            // Don't let this map grow forever.
            if (live.size > 50) { live.delete(live.keys().next().value); }
            live.set(this._id, this);

            bridge.notify({
                id: this._id,
                title: this.title,
                body: String(this.body),
                tag: String(this.tag),
                silent: !!options.silent
            });
        }

        close() {
            bridge.close(this._id);
            live.delete(this._id);
        }

        static get permission() { return OldNotification.permission; }
        static requestPermission(...args) { return OldNotification.requestPermission(...args); }
    }

    // The main process tells us when the user clicked the notification body.
    bridge.onClick((id) => {
        const n = live.get(id);
        if (n) {
            const evt = new Event('click');
            n.dispatchEvent(evt);
            if (typeof n.onclick === 'function') { n.onclick(evt); }
            live.delete(id);
        }
    });

    window.Notification = ShimNotification;
};

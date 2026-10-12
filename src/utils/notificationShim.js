/**********************************************************************************************************************
 * Replaces the page's "Notification" class with a stand-in that forwards each notification to the main process,
 * where it is shown as a native Electron notification with an inline reply field (macOS).  Clicks are relayed
 * back so the page's own handlers still run, and the existing "notification-clicked" event is still sent.
 **********************************************************************************************************************/

const { ipcRenderer } = require('electron');

module.exports.notificationShim = function (appPath) {
    const OldNotification = Notification;
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

            ipcRenderer.send('gv-notify', {
                id: this._id,
                title: this.title,
                body: this.body,
                tag: this.tag,
                silent: !!options.silent
            });
        }

        close() {
            ipcRenderer.send('gv-notify-close', this._id);
            live.delete(this._id);
        }

        static get permission() { return OldNotification.permission; }
        static requestPermission(...args) { return OldNotification.requestPermission(...args); }
    }

    // The main process tells us when the user clicked the notification body.
    ipcRenderer.on('gv-notify-click', (_event, id) => {
        const n = live.get(id);
        if (n) {
            const evt = new Event('click');
            n.dispatchEvent(evt);
            if (typeof n.onclick === 'function') { n.onclick(evt); }
            live.delete(id);
        }
        ipcRenderer.send('notification-clicked', {});
    });

    Notification = ShimNotification;
};

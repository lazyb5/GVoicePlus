/**********************************************************************************************************************
 * A tiny settings store that replaces the electron-store package (which pulled in ~30 MB of memory for what is just
 * one small JSON file).  It reads and writes the SAME file in the same format (userData/config.json, tab-indented
 * JSON, with the settings under "prefs"), so existing settings carry over untouched.
 *
 *   store.get('prefs')            -> the whole object
 *   store.get('prefs.theme')      -> a nested value (dotted path)
 *   store.set('prefs', {...})     -> saves immediately
 **********************************************************************************************************************/

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class PrefsStore {
    constructor() {
        this.file = path.join(app.getPath('userData'), 'config.json');
        this.data = this.load();
    }

    load() {
        let text;
        try { text = fs.readFileSync(this.file, 'utf8'); } catch (e) { return {}; }   // first run: no file yet
        try {
            const parsed = JSON.parse(text);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (e) {
            // Unreadable settings: keep a copy instead of silently overwriting them, then start fresh.
            try { fs.copyFileSync(this.file, this.file + '.bad'); } catch (e2) { /* ignore */ }
            return {};
        }
    }

    get(key, fallback) {
        let value = this.data;
        for (const part of String(key).split('.')) {
            if (value === null || typeof value !== 'object' || !(part in value)) { return fallback; }
            value = value[part];
        }
        return value;
    }

    set(key, value) {
        const parts = String(key).split('.');
        let target = this.data;
        parts.slice(0, -1).forEach((part) => {
            if (target[part] === null || typeof target[part] !== 'object') { target[part] = {}; }
            target = target[part];
        });
        target[parts[parts.length - 1]] = value;
        this.save();
    }

    // Write to a temporary file and rename it, so a crash mid-write can't leave a half-written settings file.
    save() {
        const temp = this.file + '.tmp';
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(temp, JSON.stringify(this.data, null, '\t'));
            fs.renameSync(temp, this.file);
        } catch (e) {
            console.error('Could not save settings: ' + e.message);
        }
    }
}

module.exports = PrefsStore;

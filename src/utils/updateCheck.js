/**********************************************************************************************************************
 * "Check for updates" (notify only): asks GitHub for the repository's latest release and, if it is newer than this
 * app, offers to open its download page.  Nothing is downloaded or installed by the app itself (that would need Apple
 * code signing), and nothing is sent except the plain public request for the latest release.
 *
 * The repository is set by UPDATE_CHECK_REPO in constants.js ("owner/name").  While it is empty, nothing happens.
 * For testing, the GV_UPDATE_REPO environment variable overrides it.
 **********************************************************************************************************************/
const { app, dialog, shell, net } = require('electron');
const constants = require('../constants');

const FIRST_CHECK_DELAY = 15 * 1000;            // let the app finish starting before the first check
const CHECK_INTERVAL    = 24 * 60 * 60 * 1000;  // then once a day while the app stays open

const repoName = () => process.env.GV_UPDATE_REPO || constants.UPDATE_CHECK_REPO || '';

// "v2025.102.101" -> [2025, 102, 101]; anything after a "-" or "+" is ignored.
const parts = (v) => String(v).trim().replace(/^v/i, '').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);

function isNewer(latest, current) {
    const a = parts(latest), b = parts(current);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0, y = b[i] || 0;
        if (x !== y) { return x > y; }
    }
    return false;
}

async function fetchLatest(repo) {
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'voice-desktop-update-check' }
    });
    if (!res.ok) { throw new Error(`GitHub answered ${res.status}`); }
    const release = await res.json();
    // Only ever open a github.com page.
    const url = /^https:\/\/github\.com\//.test(release.html_url || '') ? release.html_url : `https://github.com/${repo}/releases`;
    return { version: String(release.tag_name || ''), url };
}

function init({ getWindow, getPrefs, setPref }) {
    const say = (options) => {
        const win = getWindow();
        const parent = (win && !win.isDestroyed() && win.isVisible()) ? win : undefined;
        return dialog.showMessageBox(parent, Object.assign({ type: 'info', buttons: ['OK'], defaultId: 0 }, options));
    };

    // manual = the person chose "Check for updates" themselves, so always answer, even if nothing is new.
    async function check(manual) {
        const repo = repoName();
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
            if (manual) { await say({ message: 'Update checking is not set up in this build.' }); }
            return;
        }
        let latest;
        try {
            latest = await fetchLatest(repo);
        } catch (e) {
            console.log('Update check failed:', e.message);
            if (manual) { await say({ type: 'warning', message: 'Could not check for updates.', detail: 'Check your internet connection and try again.' }); }
            return;
        }

        if (!latest.version || !isNewer(latest.version, app.getVersion())) {
            if (manual) { await say({ message: `You are up to date (v${app.getVersion()}).` }); }
            return;
        }
        // The automatic check asks only once per new version, so it never nags.
        if (!manual && getPrefs().lastUpdatePrompt === latest.version) { return; }
        setPref('lastUpdatePrompt', latest.version);

        const answer = await say({
            message: `A new version is available: ${latest.version}`,
            detail: `You have v${app.getVersion()}. Download the new version and replace the app to update.`,
            buttons: ['Open download page', 'Later'], defaultId: 0, cancelId: 1
        });
        if (answer.response === 0) { shell.openExternal(latest.url); }
    }

    const automatic = () => { if (getPrefs().checkForUpdates !== false) { check(false); } };
    setTimeout(() => { automatic(); setInterval(automatic, CHECK_INTERVAL); }, FIRST_CHECK_DELAY);

    return { checkNow: () => check(true) };
}

module.exports = { init, isNewer };

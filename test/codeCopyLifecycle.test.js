// Clipboard lifecycle of the verification-code copier, using a fake clipboard and fake timers (no waiting).
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCopier } = require('../src/utils/codeCopy.js');

const A = 'Your verification code is 483920';
const B = 'Your verification code is 112233';
const C = 'Your verification code is 998877';

function setup({ copyCodes = true } = {}) {
    const prefs = { copyCodes };
    const clipboard = {
        text: '', writes: [], clears: 0,
        writeText(t) { this.text = t; this.writes.push(t); },
        readText() { return this.text; },
        clear() { this.text = ''; this.clears += 1; }
    };
    const timers = [];
    const logs = [];
    let notified = 0;
    const copier = createCopier({
        clipboard,
        getPrefs: () => prefs,
        notify: () => { notified += 1; },
        log: (m) => logs.push(m),
        clearAfterMs: 60000,
        setTimer: (fn, ms) => { const t = { fn, ms, cleared: false, fired: false, unrefd: false, unref() { t.unrefd = true; } }; timers.push(t); return t; },
        clearTimer: (t) => { t.cleared = true; }
    });
    const live = () => timers.filter((t) => !t.cleared && !t.fired);
    const fire = (t) => { if (!t.cleared && !t.fired) { t.fired = true; t.fn(); } };
    return { prefs, clipboard, timers, logs, copier, live, fire, notified: () => notified };
}

test('nothing is copied or scheduled while the setting is off', () => {
    const s = setup({ copyCodes: false });
    assert.equal(s.copier.onNotification(A), null);
    assert.deepEqual(s.clipboard.writes, []);
    assert.equal(s.timers.length, 0);
    assert.equal(s.notified(), 0);
});

test('a code is copied, the banner hook runs, and one clear is scheduled after the delay', () => {
    const s = setup();
    assert.equal(s.copier.onNotification(A), '483920');
    assert.deepEqual(s.clipboard.writes, ['483920']);
    assert.equal(s.notified(), 1);
    assert.equal(s.live().length, 1);
    assert.equal(s.live()[0].ms, 60000);
});

test('the scheduled timer does not keep the app alive', () => {
    const s = setup();
    s.copier.onNotification(A);
    assert.equal(s.timers[0].unrefd, true);
});

test('when the timer fires and the clipboard still holds the code, it is cleared', () => {
    const s = setup();
    s.copier.onNotification(A);
    s.fire(s.live()[0]);
    assert.equal(s.clipboard.text, '');
    assert.equal(s.clipboard.clears, 1);
});

test('when something else was copied meanwhile (another app), the clipboard is left alone', () => {
    const s = setup();
    s.copier.onNotification(A);
    s.clipboard.text = 'something I copied myself';
    s.fire(s.live()[0]);
    assert.equal(s.clipboard.text, 'something I copied myself');
    assert.equal(s.clipboard.clears, 0);
});

test('the same code notified twice inside the window is not re-copied and the deadline is not restarted', () => {
    const s = setup();
    assert.equal(s.copier.onNotification(A), '483920');
    assert.equal(s.copier.onNotification(A), '483920');
    assert.deepEqual(s.clipboard.writes, ['483920']);
    assert.equal(s.timers.length, 1);        // still the first timer, so the deadline counts from the first copy
    assert.equal(s.notified(), 1);
});

test('a different code replaces the first at once: the old timer is cancelled and only one clear is pending', () => {
    const s = setup();
    s.copier.onNotification(A);
    s.copier.onNotification(B);
    assert.deepEqual(s.clipboard.writes, ['483920', '112233']);
    assert.equal(s.clipboard.text, '112233');       // the first code is no longer on the clipboard
    assert.equal(s.timers[0].cleared, true);
    assert.equal(s.live().length, 1);
    assert.equal(s.notified(), 2);
});

test('after a replacement, the deadline runs from the newest code and clears only that one', () => {
    const s = setup();
    s.copier.onNotification(A);
    s.copier.onNotification(B);
    s.fire(s.timers[0]);                             // the cancelled first timer must do nothing
    assert.equal(s.clipboard.text, '112233');
    s.fire(s.live()[0]);
    assert.equal(s.clipboard.text, '');
    assert.equal(s.clipboard.clears, 1);
});

test('three different codes in quick succession leave one pending clear and the last code on the clipboard', () => {
    const s = setup();
    s.copier.onNotification(A);
    s.copier.onNotification(B);
    s.copier.onNotification(C);
    assert.equal(s.clipboard.text, '998877');
    assert.equal(s.live().length, 1);
    s.fire(s.live()[0]);
    assert.equal(s.clipboard.text, '');
});

test('an old code arriving again after the first was replaced is copied again', () => {
    const s = setup();
    s.copier.onNotification(A);
    s.copier.onNotification(B);
    assert.equal(s.copier.onNotification(A), '483920');
    assert.equal(s.clipboard.text, '483920');
    assert.equal(s.live().length, 1);
});

test('the same code arriving again after it was cleared is copied again', () => {
    const s = setup();
    s.copier.onNotification(A);
    s.fire(s.live()[0]);
    assert.equal(s.copier.onNotification(A), '483920');
    assert.deepEqual(s.clipboard.writes, ['483920', '483920']);
    assert.equal(s.live().length, 1);
});

test('a message that is not a code leaves the clipboard and the pending clear alone', () => {
    const s = setup();
    s.copier.onNotification(A);
    assert.equal(s.copier.onNotification('lunch at noon?'), null);
    assert.equal(s.clipboard.text, '483920');
    assert.equal(s.live().length, 1);
});

test('turning the setting off after a copy does not stop the scheduled clear', () => {
    const s = setup();
    s.copier.onNotification(A);
    s.prefs.copyCodes = false;
    assert.equal(s.copier.onNotification(B), null);   // nothing new is copied
    s.fire(s.live()[0]);
    assert.equal(s.clipboard.text, '');
});

test('flush (app quitting) clears a code that is still ours and cancels the timer', () => {
    const s = setup();
    s.copier.onNotification(A);
    s.copier.flush();
    assert.equal(s.clipboard.text, '');
    assert.equal(s.live().length, 0);
});

test('flush leaves a clipboard that has changed since alone', () => {
    const s = setup();
    s.copier.onNotification(A);
    s.clipboard.text = 'my own copy';
    s.copier.flush();
    assert.equal(s.clipboard.text, 'my own copy');
    assert.equal(s.live().length, 0);
});

test('flush with nothing copied does nothing, and a second flush is harmless', () => {
    const s = setup();
    s.copier.flush();
    s.clipboard.text = 'unrelated';
    s.copier.flush();
    assert.equal(s.clipboard.text, 'unrelated');
    assert.equal(s.clipboard.clears, 0);
    s.copier.onNotification(A);
    s.copier.flush();
    s.copier.flush();
    assert.equal(s.clipboard.clears, 1);
});

test('the code itself is never written to the log', () => {
    const s = setup();
    s.copier.onNotification(A);
    s.copier.onNotification(B);
    s.fire(s.live()[0]);
    s.copier.onNotification(C);
    s.copier.flush();
    assert.ok(s.logs.length > 0);
    for (const line of s.logs) { assert.doesNotMatch(line, /483920|112233|998877/); }
});

import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installTvScreensaver } from '@iptvnator/tv/ui';

function fixture(t: TestContext) {
    const dom = new JSDOM('<video></video>', { pretendToBeVisual: true });
    const previous = globalThis.window;
    Object.assign(globalThis, { window: dom.window });
    t.after(() => {
        dom.window.close();
        Object.assign(globalThis, { window: previous });
    });
    const video = dom.window.document.querySelector('video');
    assert.ok(video);
    const calls: number[] = [];
    const common = {
        AppCommonScreenSaverState: { SCREEN_SAVER_ON: 1, SCREEN_SAVER_OFF: 0 },
        setScreenSaver: (state: number) => calls.push(state),
    };
    Object.assign(dom.window, { webapis: { appcommon: common } });
    Object.defineProperties(video, {
        paused: { value: true, writable: true },
        ended: { value: false, writable: true },
        error: { value: null, writable: true },
    });
    const event = (name: string, state = {}) => {
        Object.assign(video, state);
        video.dispatchEvent(new dom.window.Event(name));
    };
    return { dom, video, calls, common, event };
}

test('Samsung screensaver follows actual video playback, source changes and app lifecycle', (t) => {
    const { dom, video, calls, event } = fixture(t);
    const remove = installTvScreensaver(video);
    assert.deepEqual(calls, [1], 'idle app permits the screensaver');
    event('playing', { paused: false });
    assert.equal(calls.at(-1), 0);
    event('pause', { paused: true });
    assert.equal(calls.at(-1), 1);
    event('playing', { paused: false });
    assert.equal(calls.at(-1), 0);
    event('ended', { ended: true });
    assert.equal(calls.at(-1), 1);
    event('playing', { ended: false });
    event('error', { error: { code: 3 } });
    assert.equal(calls.at(-1), 1);
    event('playing', { error: null });
    event('emptied', { paused: true });
    assert.equal(calls.at(-1), 1);
    event('playing', { paused: false });
    Object.defineProperty(dom.window.document, 'hidden', {
        value: true,
        configurable: true,
    });
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.equal(calls.at(-1), 1);
    Object.defineProperty(dom.window.document, 'hidden', { value: false });
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.equal(calls.at(-1), 0);
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    assert.equal(calls.at(-1), 1);
    event('playing');
    remove();
    assert.equal(calls.at(-1), 1, 'cleanup restores protection');
    const count = calls.length;
    event('playing');
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    assert.equal(calls.length, count, 'cleanup removes all listeners');
});

test('missing Samsung APIs leave browser and LG playback alone', (t) => {
    const { dom, video, event } = fixture(t);
    for (const bridge of [
        {},
        { webapis: {} },
        { webapis: { appcommon: {} } },
    ]) {
        Object.assign(dom.window, { webapis: undefined, ...bridge });
        const remove = installTvScreensaver(video);
        event('playing', { paused: false });
        event('pause', { paused: true });
        remove();
    }
});

test('device exceptions and async screensaver failures never escape or expose device data', (t) => {
    const { dom, video, common, event } = fixture(t);
    const warnings: unknown[][] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
    let fail: ((error: Error) => void) | undefined;
    Object.assign(common, {
        setScreenSaver: (
            _state: number,
            _success: () => void,
            error: (error: Error) => void
        ) => {
            fail = error;
        },
    });
    const remove = installTvScreensaver(video);
    assert.ok(fail);
    fail(new Error('synthetic private device details'));
    Object.assign(common, {
        setScreenSaver: () => {
            throw new Error('synthetic private device details');
        },
    });
    event('playing', { paused: false });
    remove();
    assert.deepEqual(
        warnings,
        Array(3).fill(['TV screensaver update failed.'])
    );
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    assert.equal(warnings.length, 3);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { NativePlayer } from '@iptvnator/tv/data-access';
import { Media, Progress } from '@iptvnator/tv/util';
test('native player records only confirmed playback, saves on pause and exposes write failures', async () => {
    const dom = new JSDOM('<video></video>');
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    Object.assign(globalThis, {
        document: dom.window.document,
        window: dom.window,
    });
    const video = dom.window.document.querySelector('video');
    assert.ok(video);
    Object.defineProperties(video, {
        load: {
            value() {
                return undefined;
            },
        },
        play: { value: async () => undefined },
        pause: {
            value() {
                return undefined;
            },
        },
        duration: { value: 100 },
        currentTime: { value: 0, writable: true },
    });
    const saved: Progress[] = [];
    const errors: string[] = [];
    let fail = false;
    const player = new NativePlayer(
        video,
        async (p) => {
            if (fail) throw new Error('quota');
            saved.push(p);
        },
        (m) => errors.push(m),
        () => undefined
    );
    const item: Media = {
        id: 'm',
        sourceId: 's',
        providerId: '1',
        kind: 'movie',
        title: 'Movie',
        raw: {},
    };
    try {
        await player.play(item, { url: 'https://cdn.invalid/video.mp4' }, 22);
        player.persist();
        assert.equal(saved.length, 0);
        video.dispatchEvent(new dom.window.Event('loadedmetadata'));
        assert.equal(video.currentTime, 22);
        video.dispatchEvent(new dom.window.Event('playing'));
        await Promise.resolve();
        assert.equal(saved.length, 1);
        video.currentTime = 30;
        video.dispatchEvent(new dom.window.Event('pause'));
        await Promise.resolve();
        assert.equal(saved.at(-1)?.seconds, 30);
        fail = true;
        player.persist();
        await Promise.resolve();
        await Promise.resolve();
        assert.ok(errors.some((m) => m.includes('could not be saved')));
        player.stop();
        const count = saved.length;
        player.persist();
        assert.equal(saved.length, count);
    } finally {
        player.dispose();
        dom.window.close();
        Object.assign(globalThis, {
            document: previousDocument,
            window: previousWindow,
        });
    }
});

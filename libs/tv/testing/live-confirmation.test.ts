import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { NativePlayer } from '@iptvnator/tv/data-access';
import type { Media, Progress } from '@iptvnator/tv/util';

test('late native events from stopped/old streams never confirm or save a new requested channel', async () => {
    const dom = new JSDOM('<video></video>');
    const previous = {
        document: globalThis.document,
        window: globalThis.window,
    };
    Object.assign(globalThis, {
        document: dom.window.document,
        window: dom.window,
    });
    const video = dom.window.document.querySelector('video')!;
    let currentSrc = '',
        ready = 4,
        paused = false;
    Object.defineProperties(video, {
        load: { value: () => undefined },
        play: { value: async () => undefined },
        pause: { value: () => undefined },
        currentSrc: { get: () => currentSrc },
        readyState: { get: () => ready },
        paused: { get: () => paused },
    });
    const saved: Progress[] = [],
        confirmed: Media[] = [];
    const player = new NativePlayer(
        video,
        async (p) => {
            saved.push(p);
        },
        () => undefined,
        () => undefined,
        () => undefined,
        (item) => {
            confirmed.push(item);
        }
    );
    const a: Media = {
        id: 'a',
        providerId: '1',
        sourceId: 'source',
        kind: 'live',
        title: 'Demo one',
        raw: {},
    };
    const b = { ...a, id: 'b', providerId: '2', title: 'Demo two' };
    const emit = () => video.dispatchEvent(new dom.window.Event('playing'));
    try {
        await player.play(a, { url: 'https://media.example/a.mp4' }, 0);
        currentSrc = video.src;
        emit();
        assert.equal(saved.length, 1);
        await player.play(b, { url: 'https://media.example/b.mp4' }, 0);
        const count = saved.length;
        emit();
        player.persist();
        assert.equal(saved.length, count, 'old currentSrc cannot confirm B');
        assert.equal(confirmed.at(-1)?.id, a.id);
        currentSrc = video.src;
        ready = 0;
        emit();
        ready = 4;
        paused = true;
        emit();
        assert.equal(
            saved.length,
            count,
            'empty or paused pipeline is not playing'
        );
        paused = false;
        emit();
        assert.equal(confirmed.at(-1)?.id, b.id);
        player.stop();
        const stopped = saved.length;
        emit();
        assert.equal(saved.length, stopped);
        assert.equal(confirmed.length, 2);
    } finally {
        player.dispose();
        dom.window.close();
        Object.assign(globalThis, previous);
    }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { NativePlayer } from '@iptvnator/tv/data-access';
import { Media } from '@iptvnator/tv/util';

test('native HLS selects its transport before loading and clears sources when switching or stopping', async () => {
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
    const loads: Array<{ src: string | null; sources: string[] }> = [];
    Object.defineProperties(video, {
        load: {
            value: () =>
                loads.push({
                    src: video.getAttribute('src'),
                    sources: Array.from(video.querySelectorAll('source')).map(
                        (s) => `${s.type} ${s.src}`
                    ),
                }),
        },
        play: { value: async () => undefined },
        pause: { value: () => undefined },
    });
    const failures: string[] = [];
    const player = new NativePlayer(
        video,
        async () => undefined,
        (message) => failures.push(message),
        () => undefined
    );
    const item: Media = {
        id: 'live',
        sourceId: 'source',
        providerId: '1',
        kind: 'live',
        title: 'Channel',
        raw: {},
    };
    try {
        for (const url of [
            'https://cdn.example/live.m3u8?token=first',
            'https://cdn.example/other.M3U8?token=second#fragment',
        ]) {
            await player.play(item, { url }, 0);
            assert.deepEqual(loads.at(-1), {
                src: null,
                sources: [`application/vnd.apple.mpegurl ${url}`],
            });
            assert.deepEqual(loads.at(-2), { src: null, sources: [] });
        }
        const rejectedSource = video.querySelector('source')!;
        rejectedSource.dispatchEvent(new dom.window.Event('error'));
        assert.equal(failures.length, 1, 'source rejection must reach the UI');
        player.stop();
        assert.deepEqual(loads.at(-1), { src: null, sources: [] });
        rejectedSource.dispatchEvent(new dom.window.Event('error'));
        assert.equal(failures.length, 1, 'obsolete source errors are ignored');
        for (const url of [
            'https://cdn.example/video.mp4',
            'https://cdn.example/live.ts',
            'https://cdn.example/stream?filename=live.m3u8',
        ]) {
            await player.play(item, { url }, 0);
            assert.deepEqual(loads.at(-1), { src: url, sources: [] });
        }
    } finally {
        player.dispose();
        dom.window.close();
        Object.assign(globalThis, previous);
    }
});

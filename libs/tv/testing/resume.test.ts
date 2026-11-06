import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { NativePlayer } from '@iptvnator/tv/data-access';
import { Media, Progress } from '@iptvnator/tv/util';

function fixture() {
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
    const state = {
        time: 0,
        duration: Infinity,
        ready: 1,
        seeking: false,
        accepts: false,
        attempts: 0,
    };
    Object.defineProperties(video, {
        load: { value: () => undefined },
        play: { value: async () => undefined },
        pause: { value: () => undefined },
        duration: { get: () => state.duration },
        readyState: { get: () => state.ready },
        seeking: { get: () => state.seeking },
        currentTime: {
            get: () => state.time,
            set: (n: number) => {
                state.attempts++;
                if (state.accepts) {
                    state.time = n;
                    state.seeking = true;
                }
            },
        },
        seekable: {
            get: () => ({
                length: state.ready >= 3 ? 1 : 0,
                start: () => 0,
                end: () => state.duration,
            }),
        },
    });
    const saved: Progress[] = [],
        errors: string[] = [];
    const player = new NativePlayer(
        video,
        async (p) => {
            saved.push(p);
        },
        (e) => errors.push(e),
        () => undefined
    );
    const emit = (name: string) =>
        video.dispatchEvent(new dom.window.Event(name));
    const item: Media = {
        id: 'vod',
        sourceId: 'source',
        providerId: '1',
        kind: 'movie',
        title: 'Movie',
        raw: {},
    };
    return {
        state,
        saved,
        errors,
        player,
        emit,
        item,
        close: () => {
            player.dispose();
            dom.window.close();
            Object.assign(globalThis, previous);
        },
    };
}
for (const kind of ['movie', 'episode'] as const) {
    test(`${kind} resume waits for late duration and retries an ignored native seek without saving zero`, async (t) => {
        t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
        const f = fixture();
        try {
            await f.player.play(
                { ...f.item, kind },
                { url: 'https://media.example/vod' },
                1200
            );
            f.emit('loadedmetadata');
            f.emit('playing');
            assert.equal(
                f.saved.length,
                0,
                'pending resume must protect stored progress'
            );
            f.state.duration = 3600;
            f.state.ready = 4;
            f.emit('durationchange');
            assert.equal(f.state.attempts, 1);
            assert.equal(
                f.state.time,
                0,
                'first seek was ignored by native engine'
            );
            f.emit('timeupdate');
            f.state.accepts = true;
            t.mock.timers.tick(1000);
            assert.equal(f.state.time, 1200);
            f.player.persist();
            assert.equal(
                f.saved.length,
                0,
                'an assigned position is not a confirmed seek'
            );
            f.state.seeking = false;
            f.emit('seeked');
            f.emit('timeupdate');
            f.player.persist();
            assert.equal(f.saved.at(-1)?.seconds, 1200);
            assert.equal(f.errors.length, 0);
        } finally {
            f.close();
        }
    });
}
test('failed resume preserves the old position; stop cancels retries before another title plays', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
    const f = fixture();
    try {
        await f.player.play(f.item, { url: 'https://media.example/vod' }, 1200);
        f.emit('playing');
        t.mock.timers.tick(31000);
        assert.equal(f.saved.length, 0);
        assert.ok(f.errors.some((e) => e.includes('saved position')));
        f.player.stop();
        f.state.duration = 3600;
        f.state.ready = 4;
        f.state.accepts = true;
        await f.player.play(
            { ...f.item, id: 'other' },
            { url: 'https://media.example/other' },
            0
        );
        f.emit('playing');
        f.emit('loadedmetadata');
        t.mock.timers.tick(1000);
        assert.equal(f.state.time, 0);
        assert.equal(f.saved.at(-1)?.item.id, 'other');
    } finally {
        f.close();
    }
});
test('explicit positive timeline seeks use the same confirmed retry and live never restores', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
    const f = fixture();
    try {
        await f.player.play(f.item, { url: 'https://media.example/vod' }, 0);
        f.state.duration = 3600;
        f.state.ready = 4;
        f.emit('playing');
        f.saved.length = 0;
        f.player.seekTo(1200);
        assert.equal(f.state.time, 0);
        f.emit('pause');
        assert.equal(f.saved.length, 0);
        f.state.accepts = true;
        t.mock.timers.tick(1000);
        f.state.seeking = false;
        f.emit('seeked');
        assert.equal(f.saved.at(-1)?.seconds, 1200);
        f.player.stop();
        f.state.time = 0;
        f.state.attempts = 0;
        await f.player.play(
            { ...f.item, kind: 'live' },
            { url: 'https://media.example/live' },
            1200
        );
        f.emit('playing');
        t.mock.timers.tick(1000);
        assert.equal(f.state.attempts, 0);
    } finally {
        f.close();
    }
});

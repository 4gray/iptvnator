import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
    useUpNext,
    tvAutoplayStreak,
    type TvModel,
    type VodSequence,
} from '@iptvnator/tv/feature';
import type { Media } from '@iptvnator/tv/util';

for (const seekBack of [false, true]) {
    test(`a TV successor ${seekBack ? 'yields to a synchronous seek' : 'retains its committed claim'}`, async () => {
        const dom = new JSDOM('<div id="root"></div><video></video>', {
            pretendToBeVisual: true,
        });
        const previous = {
            document: globalThis.document,
            window: globalThis.window,
        };
        Object.assign(globalThis, {
            document: dom.window.document,
            window: dom.window,
        });
        const root = document.getElementById('root')!;
        const video = { current: document.querySelector('video')! };
        const first = { id: 'episode-1', kind: 'episode' } as Media;
        const next = { id: 'episode-2', kind: 'episode' } as Media;
        let ended = false;
        Object.defineProperty(video.current, 'ended', { get: () => ended });
        const tv = {
            fullscreen: true,
            playing: first,
            data: {
                seriesAutoplay: true,
                playerUpNextCard: false,
                positions: {},
            },
        } as unknown as TvModel;
        let resolveLink!: () => void;
        const link = new Promise<void>((resolve) => (resolveLink = resolve));
        let finish!: () => void;
        const pending = new Promise<void>((resolve) => (finish = resolve));
        let signal: AbortSignal | undefined;
        const vod = {
            next,
            activating: false,
            playNext: async (request?: AbortSignal) => {
                signal = request;
                await link;
                if (request?.aborted) return false;
                tv.playing = next;
                ended = false;
                render(h(Player, {}), root);
                await pending;
                return true;
            },
        } as unknown as VodSequence;
        function Player() {
            useUpNext(tv, video, vod, false, () => undefined);
            return null;
        }
        tvAutoplayStreak.reset();
        try {
            await act(() => render(h(Player, {}), root));
            await act(() => {
                ended = true;
                video.current.dispatchEvent(new dom.window.Event('ended'));
            });
            await act(async () => {
                if (seekBack) {
                    ended = false;
                    video.current.dispatchEvent(
                        new dom.window.Event('timeupdate')
                    );
                }
                resolveLink();
                await Promise.resolve();
            });
            assert.equal(tv.playing!.id, seekBack ? first.id : next.id);
            assert.equal(signal?.aborted, seekBack);
            assert.equal(tvAutoplayStreak.length, seekBack ? 0 : 1);
        } finally {
            resolveLink();
            finish();
            await act(() => render(null, root));
            tvAutoplayStreak.reset();
            Object.assign(globalThis, previous);
            dom.window.close();
        }
    });
}

for (const action of ['replay', 'series details'] as const) {
    test(`a pending TV ${action} owns a late successor`, async () => {
        const dom = new JSDOM('<div id="root"></div><video></video>', {
            pretendToBeVisual: true,
        });
        const previous = {
            document: globalThis.document,
            window: globalThis.window,
        };
        Object.assign(globalThis, {
            document: dom.window.document,
            window: dom.window,
        });
        const root = document.getElementById('root')!;
        const video = { current: document.querySelector('video')! };
        let ended = false;
        Object.defineProperty(video.current, 'ended', { get: () => ended });
        const tv = {
            fullscreen: true,
            playing: { id: 'episode-1', kind: 'episode' },
            replayPending: false,
            data: {
                seriesAutoplay: true,
                playerUpNextCard: false,
                positions: {},
            },
        } as unknown as TvModel;
        let detailsPending = false;
        let starts = 0;
        const vod = {
            next: undefined,
            activating: false,
            playNext: async () => {
                starts++;
                return true;
            },
        } as unknown as VodSequence;
        function Player() {
            useUpNext(tv, video, vod, false, () => undefined, detailsPending);
            return null;
        }
        tvAutoplayStreak.reset();
        try {
            await act(() => render(h(Player, {}), root));
            await act(() => {
                ended = true;
                video.current.dispatchEvent(new dom.window.Event('ended'));
            });
            await act(() => {
                tv.replayPending = action === 'replay';
                detailsPending = action === 'series details';
                render(h(Player, {}), root);
            });
            await act(() => {
                vod.next = { id: 'episode-2', kind: 'episode' } as Media;
                render(h(Player, {}), root);
            });
            assert.equal(starts, 0);
        } finally {
            await act(() => render(null, root));
            tvAutoplayStreak.reset();
            Object.assign(globalThis, previous);
            dom.window.close();
        }
    });
}

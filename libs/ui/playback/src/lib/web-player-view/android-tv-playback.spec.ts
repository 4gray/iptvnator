import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AndroidTvPlayback } from './android-tv-playback';

@Component({ template: '' })
class RenderHost {}

function setup() {
    const postMessage = jest.fn();
    const shell = { postMessage };
    const tvWindow = Object.assign(window, {
        TvShell: shell,
        iptvnatorAndroidPlaybackLabels: { open: 'Open', back: 'Back' },
    });
    const events: string[] = [];
    const token = signal(Symbol());
    const fixture = TestBed.createComponent(RenderHost);
    const playback = TestBed.runInInjectionContext(
        () =>
            new AndroidTvPlayback(
                () => 'synthetic-session',
                token,
                () => events.push('watched'),
                () => events.push('position'),
                () => events.push('ended')
            )
    );

    const surface = document.createElement('div');
    const video = surface.appendChild(document.createElement('video'));
    video.muted = true;

    function open() {
        playback.open(
            {
                streamUrl: 'https://media.example.test/synthetic-episode.mkv',
                title: 'Synthetic episode',
                contentInfo: {
                    playlistId: 'synthetic-playlist',
                    contentXtreamId: 17,
                    contentType: 'episode',
                    seriesXtreamId: 3,
                    activitySessionId: 'synthetic-activity',
                    activityTitle: 'Synthetic private title',
                },
            },
            false,
            0,
            false,
            surface
        );
        fixture.detectChanges();
        const message = postMessage.mock.lastCall?.[0] as string;
        const [, id, request] = JSON.parse(message);
        expect(request.volume).toBe(0);
        expect(request.checkpoint).toEqual({
            playlistId: 'synthetic-playlist',
            contentXtreamId: 17,
            contentType: 'episode',
            seriesXtreamId: 3,
            activitySessionId: 'synthetic-activity',
        });
        return id as string;
    }

    function reply(id: string, ended: boolean, playedMs = 9000) {
        window.dispatchEvent(
            new CustomEvent('iptvnator:android-playback-result', {
                detail: {
                    id,
                    result: {
                        positionMs: 9000,
                        durationMs: 9000,
                        playedMs,
                        ended,
                    },
                },
            })
        );
    }

    const clear = () => {
        Reflect.deleteProperty(tvWindow, 'TvShell');
        Reflect.deleteProperty(tvWindow, 'iptvnatorAndroidPlaybackLabels');
    };
    return {
        clear,
        events,
        fixture,
        open,
        playback,
        postMessage,
        reply,
        surface,
        token,
        tvWindow,
    };
}

it('reports only an owned natural end after recording the final position', () => {
    const { clear, events, open, reply, token } = setup();
    try {
        reply(open(), false, 100);
        expect(events).toEqual(['position']);

        const oldId = open();
        token.set(Symbol());
        reply(oldId, true);
        expect(events).toEqual(['position']);

        const id = open();
        reply(id, true);
        reply(id, true);
        expect(events).toEqual(['position', 'watched', 'position', 'ended']);
    } finally {
        clear();
    }
});

it('restores the web engine if Android rejects playback or is disabled', () => {
    const { clear, open, playback, tvWindow } = setup();
    try {
        const id = open();
        expect(playback.suspended()).toBe(true);
        window.dispatchEvent(
            new CustomEvent('iptvnator:android-playback-result', {
                detail: { id, result: null },
            })
        );
        expect(playback.suspended()).toBe(false);

        open();
        Reflect.deleteProperty(tvWindow, 'iptvnatorAndroidPlaybackLabels');
        window.dispatchEvent(
            new Event('iptvnator:android-playback-availability')
        );
        expect(playback.labels()).toBeNull();
        expect(playback.suspended()).toBe(false);
    } finally {
        clear();
    }
});

it('carries provider headers and recovers if the native bridge throws', () => {
    const { clear, fixture, playback, postMessage, surface } = setup();
    try {
        postMessage.mockImplementation(() => {
            throw new Error('Synthetic bridge failure');
        });
        playback.open(
            {
                streamUrl: 'https://media.example.test/synthetic-live.m3u8',
                title: 'Synthetic live stream',
                headers: { 'User-Agent': 'Synthetic-Player' },
                userAgent: 'Unused synthetic user agent',
                referer: 'https://example.test/player',
                origin: 'https://example.test',
            },
            true,
            0,
            false,
            surface
        );
        fixture.detectChanges();
        const [, , request] = JSON.parse(
            postMessage.mock.lastCall?.[0] as string
        );
        expect(request).toMatchObject({
            hls: true,
            headers: {
                'User-Agent': 'Synthetic-Player',
                referer: 'https://example.test/player',
                origin: 'https://example.test',
            },
        });
        expect(playback.suspended()).toBe(false);
    } finally {
        clear();
    }
});

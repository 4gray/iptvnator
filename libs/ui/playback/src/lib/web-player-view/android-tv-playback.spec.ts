import { ControlsVolume } from '../player-controls/controls-volume';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ParentalLockService } from '@iptvnator/services';
import { AndroidTvPlayback } from './android-tv-playback';

@Component({ template: '' })
class RenderHost {}

function setup() {
    const postMessage = jest.fn();
    const parentalLock = signal(false);
    TestBed.configureTestingModule({
        providers: [
            {
                provide: ParentalLockService,
                useValue: { enabled: parentalLock },
            },
        ],
    });
    const shell = { postMessage };
    const tvWindow = Object.assign(window, {
        TvShell: shell,
        iptvnatorAndroidPlaybackEnabled: true,
    });
    const events: string[] = [];
    const storedVolume = localStorage.getItem('volume');
    const storedAudibleVolume = localStorage.getItem('volume.lastAudible');
    const token = signal(Symbol());
    const reload = jest.fn(() => token.set(Symbol()));
    const onPosition = jest.fn(() => events.push('position'));
    const fixture = TestBed.createComponent(RenderHost);
    const playback = TestBed.runInInjectionContext(
        () =>
            new AndroidTvPlayback(
                () => 'synthetic-session',
                token,
                signal(1),
                (seconds) => events.push(`played:${seconds}`),
                onPosition,
                () => events.push('ended'),
                reload
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
            profile: 'iptvnator',
            playlistId: 'synthetic-playlist',
            contentXtreamId: 17,
            contentType: 'episode',
            seriesXtreamId: 3,
            activitySessionId: 'synthetic-activity',
        });
        return id as string;
    }

    function reply(
        id: string,
        ended: boolean,
        playedMs = 9000,
        durationMs = 9000,
        failed = false
    ) {
        window.dispatchEvent(
            new CustomEvent('iptvnator:android-playback-result', {
                detail: {
                    id,
                    result: {
                        positionMs: 9000,
                        durationMs,
                        playedMs,
                        ended,
                        failed,
                    },
                },
            })
        );
    }

    const clear = () => {
        Reflect.deleteProperty(tvWindow, 'TvShell');
        Reflect.deleteProperty(tvWindow, 'iptvnatorAndroidPlaybackEnabled');
        if (storedVolume === null) localStorage.removeItem('volume');
        else localStorage.setItem('volume', storedVolume);
        if (storedAudibleVolume === null)
            localStorage.removeItem('volume.lastAudible');
        else localStorage.setItem('volume.lastAudible', storedAudibleVolume);
    };
    return {
        clear,
        events,
        fixture,
        open,
        onPosition,
        parentalLock,
        playback,
        postMessage,
        reply,
        reload,
        surface,
        token,
        tvWindow,
    };
}

it('keeps an attempt across Android settings refreshes and retires it for a new application', () => {
    const { clear, playback, token, tvWindow } = setup();
    try {
        const attempt = playback.attempt();
        expect(attempt).toBeTruthy();
        tvWindow.dispatchEvent(
            new Event('iptvnator:android-playback-availability')
        );
        expect(playback.attempt()).toBe(attempt);
        token.set(Symbol());
        expect(playback.attempt()).not.toBe(attempt);
    } finally {
        clear();
    }
});

it('keeps a failed attempt only for an explicit return to the same web player', () => {
    const { clear, playback, open, reply, token } = setup();
    try {
        const attempt = playback.attempt();
        reply(open(), false, 0, 9000, true);
        playback.returnToWeb();
        expect(playback.attempt()).toBe(attempt);
        token.set(Symbol());
        expect(playback.attempt()).not.toBe(attempt);
    } finally {
        clear();
    }
});

it('cancels the posted native launch when retrying the web player', () => {
    const { clear, events, open, playback, postMessage, reply } = setup();
    try {
        const id = open();
        playback.returnToWeb();

        expect(postMessage).toHaveBeenLastCalledWith(
            JSON.stringify(['stopNative', id])
        );
        expect(playback.suspended()).toBe(false);
        reply(id, true);
        expect(events).toEqual([]);
    } finally {
        clear();
    }
});

it('reports only an owned natural end after recording the final position', () => {
    const { clear, events, open, reply, token } = setup();
    try {
        reply(open(), false, 100);
        expect(events).toEqual(['played:0.1', 'position']);

        const oldId = open();
        token.set(Symbol());
        reply(oldId, true);
        expect(events).toEqual(['played:0.1', 'position']);

        const id = open();
        reply(id, true);
        reply(id, true);
        expect(events).toEqual([
            'played:0.1',
            'position',
            'played:9',
            'position',
            'ended',
        ]);
    } finally {
        clear();
    }
});

it('uses half volume for Android unmute when no audible volume is known', () => {
    const { clear, open, postMessage, surface } = setup();
    try {
        localStorage.removeItem('volume.lastAudible');
        surface.querySelector('video')!.volume = 0;
        open();
        expect(JSON.parse(postMessage.mock.lastCall![0])[2].audibleVolume).toBe(
            0.5
        );
    } finally {
        clear();
    }
});

it('carries the previous audible volume through the native launch and the web remount', () => {
    const { clear, open, playback, postMessage, reply, surface } = setup();
    try {
        const apply = jest.fn();
        const controls = () =>
            new ControlsVolume({
                apply,
                flash: () => undefined,
                mutedLabel: () => 'Muted',
                openPopover: () => undefined,
                closePopover: () => undefined,
            });
        const priorControls = controls();
        priorControls.set(0.1);
        priorControls.toggleMute();
        surface.querySelector('video')!.volume = 0;
        const id = open();
        const [, , request] = JSON.parse(postMessage.mock.lastCall![0]);
        expect(request.audibleVolume).toBe(0.1);
        reply(id, false);
        playback.restoreWebVolume();
        expect(playback.webVolume()).toBe(0);

        const resumed = controls();
        resumed.toggleMute();
        expect(apply).toHaveBeenLastCalledWith(0.1);
    } finally {
        clear();
    }
});

it.each([
    '(format=m3u8-aapl)?token=synthetic',
    '(format=m3u8-aapl,filter=synthetic)',
    '(filter=synthetic,format=m3u8-aapl-v3)',
])('offers the HLS variant %s of a Smooth Streaming path', (suffix) => {
    const { clear, playback, fixture, postMessage, surface } = setup();
    try {
        const base = 'https://media.example.test/synthetic.ism/Manifest';
        expect(playback.canOpen({ streamUrl: base, title: 'Synthetic' })).toBe(
            false
        );
        expect(
            playback.canOpen({
                streamUrl: base.replace('.ism', '%2Eism'),
                title: 'Synthetic Smooth Streaming',
            })
        ).toBe(false);
        const request = {
            streamUrl: base + suffix,
            title: 'Synthetic HLS',
        };
        expect(playback.canOpen(request)).toBe(true);
        playback.open(request, true, 0, false, surface);
        fixture.detectChanges();
        expect(JSON.parse(postMessage.mock.lastCall![0])[2]).toMatchObject({
            hls: true,
        });
    } finally {
        clear();
    }
});

it.each(['.mpd', '%2Empd', '.mpd/', '%2Empd//'])(
    'rejects DASH path %s regardless of the extension hint',
    (suffix) => {
        const { clear, playback } = setup();
        try {
            expect(
                playback.canOpen({
                    streamUrl: `https://media.example.test/synthetic${suffix}?extension=m3u8`,
                    title: 'Synthetic DASH',
                })
            ).toBe(false);
        } finally {
            clear();
        }
    }
);

it('keeps mute on a second launch after the web video has unmounted', () => {
    const { clear, open, playback, reply, surface } = setup();
    try {
        reply(open(), false);
        surface.querySelector('video')?.remove();
        reply(open(), false);
        playback.restoreWebVolume();
        expect(playback.webVolume()).toBe(0);
        expect(localStorage.getItem('volume')).toBe('0');
    } finally {
        clear();
    }
});

it('reports a completed position with a separate replay point of zero', () => {
    const { clear, open, reply, onPosition } = setup();
    try {
        reply(open(), true);
        expect(onPosition).toHaveBeenCalledWith(
            expect.objectContaining({ currentTime: 9, checkpoint: true }),
            0
        );
    } finally {
        clear();
    }
});

it('uses the playhead as the resume point when VOD duration is unknown', () => {
    const { clear, open, reply, onPosition } = setup();
    try {
        reply(open(), false, 100, 0);
        expect(onPosition).toHaveBeenCalledWith(
            expect.objectContaining({
                currentTime: 9,
                duration: 0,
                checkpoint: true,
            }),
            9
        );
    } finally {
        clear();
    }
});

it('leaves malformed and credential-bearing URLs to the existing player', () => {
    const { clear, playback } = setup();
    try {
        for (const streamUrl of [
            'https://synthetic:synthetic@media.example.test/episode.mkv',
            'https://',
            'https://media.example.test/synthetic.ism/Manifest',
        ]) {
            expect(
                playback.canOpen({ streamUrl, title: 'Synthetic episode' })
            ).toBe(false);
        }
        expect(
            playback.canOpen({
                streamUrl: 'https://media.example.test/synthetic.mp4',
                title: 'Synthetic episode',
                requiresFreshStreamUrl: true,
            })
        ).toBe(false);
    } finally {
        clear();
    }
});

it('cancels the owned handoff when parental controls are enabled', () => {
    const { clear, fixture, open, playback, postMessage, parentalLock } =
        setup();
    try {
        const id = open();
        parentalLock.set(true);
        fixture.detectChanges();
        expect(postMessage).toHaveBeenLastCalledWith(
            JSON.stringify(['stopNative', id])
        );
        expect(
            playback.canOpen({
                streamUrl: 'https://media.example.test/synthetic.mp4',
                title: 'Synthetic episode',
            })
        ).toBe(false);
    } finally {
        clear();
    }
});

it('restores the web engine if Android rejects playback or is disabled', () => {
    const { clear, open, playback, reload, reply, tvWindow } = setup();
    try {
        const id = open();
        expect(playback.suspended()).toBe(true);
        window.dispatchEvent(
            new CustomEvent('iptvnator:android-playback-result', {
                detail: { id, result: null },
            })
        );
        expect(playback.suspended()).toBe(false);
        expect(reload).toHaveBeenCalledTimes(1);

        reply(open(), false);
        Reflect.deleteProperty(tvWindow, 'iptvnatorAndroidPlaybackEnabled');
        window.dispatchEvent(
            new Event('iptvnator:android-playback-availability')
        );
        expect(playback.attempt()).toBeTruthy();
        expect(playback.suspended()).toBe(false);
        expect(reload).toHaveBeenCalledTimes(2);
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
                headers: {
                    'User-Agent': 'Synthetic-Default',
                    Referer: 'https://example.test/default',
                },
                userAgent: 'Synthetic-Player',
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
                'user-agent': 'Synthetic-Player',
                referer: 'https://example.test/player',
                origin: 'https://example.test',
            },
        });
        expect(playback.suspended()).toBe(false);
    } finally {
        clear();
    }
});

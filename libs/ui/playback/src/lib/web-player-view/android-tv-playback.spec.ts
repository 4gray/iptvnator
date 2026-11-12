import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AndroidTvPlayback } from './android-tv-playback';

@Component({ template: '' })
class RenderHost {}

it('reports only an owned natural end after recording the final position', () => {
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

    function open() {
        playback.open(
            {
                streamUrl: 'https://media.example.test/synthetic-episode.mkv',
                title: 'Synthetic episode',
            },
            false,
            0,
            false
        );
        fixture.detectChanges();
        const message = postMessage.mock.lastCall?.[0] as string;
        const [, id] = JSON.parse(message);
        return id as string;
    }

    function reply(id: string, ended: boolean) {
        window.dispatchEvent(
            new CustomEvent('iptvnator:android-playback-result', {
                detail: {
                    id,
                    result: {
                        positionMs: 9000,
                        durationMs: 9000,
                        playedMs: 9000,
                        ended,
                    },
                },
            })
        );
    }

    try {
        reply(open(), false);
        expect(events).toEqual(['watched', 'position']);

        const oldId = open();
        token.set(Symbol());
        reply(oldId, true);
        expect(events).toEqual(['watched', 'position']);

        const id = open();
        reply(id, true);
        reply(id, true);
        expect(events).toEqual([
            'watched',
            'position',
            'watched',
            'position',
            'ended',
        ]);
    } finally {
        Reflect.deleteProperty(tvWindow, 'TvShell');
        Reflect.deleteProperty(tvWindow, 'iptvnatorAndroidPlaybackLabels');
    }
});

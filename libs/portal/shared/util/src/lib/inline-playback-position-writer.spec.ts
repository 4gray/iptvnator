import { signal } from '@angular/core';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { createInlinePlaybackPositionWriter } from './inline-playback-position-writer';

function playbackWithInfo(): ResolvedPortalPlayback {
    return {
        streamUrl: 'http://example.com/movie.mkv',
        title: 'Dune',
        contentInfo: {
            playlistId: 'playlist-1',
            contentXtreamId: 42,
            contentType: 'vod',
        },
    };
}

function setup(initial: ResolvedPortalPlayback | null = playbackWithInfo()) {
    const playback = signal<ResolvedPortalPlayback | null>(initial);
    const save = jest.fn();
    const onSaved = jest.fn();
    const writer = createInlinePlaybackPositionWriter({
        playback,
        save,
        onSaved,
    });
    return { playback, save, onSaved, writer };
}

describe('createInlinePlaybackPositionWriter', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('writes the first update immediately', () => {
        const { writer, save, onSaved } = setup();

        writer.handleTimeUpdate({ currentTime: 12.7, duration: 100.2 });

        expect(save).toHaveBeenCalledWith('playlist-1', {
            playlistId: 'playlist-1',
            contentXtreamId: 42,
            contentType: 'vod',
            positionSeconds: 12,
            durationSeconds: 100,
        });
        expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it('throttles subsequent updates to one per 15s', () => {
        jest.useFakeTimers();
        const { writer, save } = setup();

        writer.handleTimeUpdate({ currentTime: 1, duration: 100 });
        expect(save).toHaveBeenCalledTimes(1);

        // The player fires ~4x/second; none of these may reach storage.
        jest.advanceTimersByTime(5000);
        writer.handleTimeUpdate({ currentTime: 6, duration: 100 });
        jest.advanceTimersByTime(5000);
        writer.handleTimeUpdate({ currentTime: 11, duration: 100 });
        expect(save).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(6000);
        writer.handleTimeUpdate({ currentTime: 17, duration: 100 });
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('reset makes the next update write immediately', () => {
        jest.useFakeTimers();
        const { writer, save } = setup();

        writer.handleTimeUpdate({ currentTime: 1, duration: 100 });
        jest.advanceTimersByTime(1000);
        writer.handleTimeUpdate({ currentTime: 2, duration: 100 });
        expect(save).toHaveBeenCalledTimes(1);

        writer.reset();
        writer.handleTimeUpdate({ currentTime: 3, duration: 100 });
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('writes nothing without a playback', () => {
        const { writer, save } = setup(null);

        writer.handleTimeUpdate({ currentTime: 5, duration: 100 });

        expect(save).not.toHaveBeenCalled();
    });

    it('writes nothing without contentInfo — there is no key to store under', () => {
        const { writer, save } = setup({
            streamUrl: 'http://example.com/movie.mkv',
            title: 'Dune',
        });

        writer.handleTimeUpdate({ currentTime: 5, duration: 100 });

        expect(save).not.toHaveBeenCalled();
    });

    it('floors fractional times', () => {
        const { writer, save } = setup();

        writer.handleTimeUpdate({ currentTime: 9.99, duration: 42.99 });

        expect(save.mock.calls[0][1]).toEqual(
            expect.objectContaining({
                positionSeconds: 9,
                durationSeconds: 42,
            })
        );
    });
});

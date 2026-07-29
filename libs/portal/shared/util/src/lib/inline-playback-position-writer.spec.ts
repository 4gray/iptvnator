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

    describe('resume latch', () => {
        function resuming(startTime: number): ResolvedPortalPlayback {
            return { ...playbackWithInfo(), startTime };
        }

        it('drops updates emitted before the engine reaches startTime', () => {
            // A resuming engine ticks at ~0 while it is still seeking. Writing
            // one of those overwrites the very position being resumed from.
            const { writer, save } = setup(resuming(2538));

            expect(
                writer.handleTimeUpdate({ currentTime: 12, duration: 7744 })
            ).toBe(false);
            expect(save).not.toHaveBeenCalled();
        });

        it('releases once, so a later seek backwards is still saved', () => {
            jest.useFakeTimers();
            const { writer, save } = setup(resuming(2538));

            writer.handleTimeUpdate({ currentTime: 12, duration: 7744 });
            // Reaching the resume point latches the guard open for good.
            writer.handleTimeUpdate({ currentTime: 2540, duration: 7744 });

            jest.advanceTimersByTime(16000);
            expect(
                writer.handleTimeUpdate({ currentTime: 30, duration: 7744 })
            ).toBe(true);
            expect(save).toHaveBeenLastCalledWith(
                'playlist-1',
                expect.objectContaining({ positionSeconds: 30 })
            );
        });

        it('gives up on a resume point the source cannot reach', () => {
            // Two hours carried into a 90-minute cut: the engine can never
            // report that time, so latching on it would suppress every save
            // for the whole session.
            const { writer, save } = setup(resuming(7200));

            expect(
                writer.handleTimeUpdate({ currentTime: 12, duration: 5400 })
            ).toBe(true);
            expect(save).toHaveBeenCalled();
        });

        it('keeps the latch closed across an update with no contentInfo', () => {
            const { writer, playback } = setup(resuming(2538));

            writer.handleTimeUpdate({ currentTime: 12, duration: 7744 });
            playback.set({ streamUrl: 'http://example.com/x.mkv', title: 'X' });

            // Reporting `true` here would tell multi-source that a timecode of
            // ~0 can be carried to the next source.
            expect(
                writer.handleTimeUpdate({ currentTime: 13, duration: 7744 })
            ).toBe(false);
        });

        it('is cleared by reset, so a new resume waits again', () => {
            const { writer, playback } = setup();

            writer.handleTimeUpdate({ currentTime: 40, duration: 7744 });
            playback.set(resuming(2538));
            writer.reset();

            expect(
                writer.handleTimeUpdate({ currentTime: 12, duration: 7744 })
            ).toBe(false);
        });
    });
});

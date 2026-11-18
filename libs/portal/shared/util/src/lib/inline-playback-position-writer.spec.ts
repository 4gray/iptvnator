import { signal } from '@angular/core';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { createInlinePlaybackPositionWriter } from './inline-playback-position-writer';

function playbackWithInfo(): ResolvedPortalPlayback {
    return {
        streamUrl: 'http://example.com/movie.mkv',
        title: 'Synthetic Feature',
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

    it('flushes the newest accepted position under its original media key', () => {
        jest.useFakeTimers();
        const { playback, writer, save } = setup();
        writer.handleTimeUpdate({ currentTime: 12, duration: 100 });
        writer.handleTimeUpdate({ currentTime: 21, duration: 100 });
        playback.set(null);

        writer.flush();
        writer.flush();

        expect(save).toHaveBeenCalledTimes(2);
        expect(save).toHaveBeenLastCalledWith(
            'playlist-1',
            expect.objectContaining({
                contentXtreamId: 42,
                positionSeconds: 21,
            })
        );
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

    it('reset persists the held position, then the next update writes immediately', () => {
        jest.useFakeTimers();
        const { writer, save } = setup();

        writer.handleTimeUpdate({ currentTime: 1, duration: 100 });
        jest.advanceTimersByTime(1000);
        writer.handleTimeUpdate({ currentTime: 2, duration: 100 });
        expect(save).toHaveBeenCalledTimes(1);

        writer.reset();
        expect(save).toHaveBeenCalledTimes(2);
        expect(save).toHaveBeenLastCalledWith(
            'playlist-1',
            expect.objectContaining({ positionSeconds: 2 })
        );

        writer.handleTimeUpdate({ currentTime: 3, duration: 100 });
        expect(save).toHaveBeenCalledTimes(3);
    });

    describe('closing the player', () => {
        it('persists the last position the throttle held back', () => {
            // The audit reproduction: one tick per second from 600 s, then
            // the player closes. Only 600 reached storage, so Resume went
            // back 14 seconds.
            jest.useFakeTimers();
            const { playback, writer, save } = setup();
            for (let second = 600; second <= 614; second++) {
                writer.handleTimeUpdate({ currentTime: second, duration: 7200 });
                jest.advanceTimersByTime(1000);
            }
            playback.set(null);

            writer.reset();

            expect(save.mock.calls.map(([, p]) => p.positionSeconds)).toEqual([
                600, 614,
            ]);
        });

        it('writes the held position under the media that produced it', () => {
            const { playback, writer, save } = setup();
            writer.handleTimeUpdate({ currentTime: 10, duration: 100 });
            writer.handleTimeUpdate({ currentTime: 11, duration: 100 });
            // The next playback is already mounted when the host resets.
            playback.set({
                ...playbackWithInfo(),
                contentInfo: {
                    playlistId: 'playlist-2',
                    contentXtreamId: 7,
                    contentType: 'vod',
                },
                startTime: 300,
            });

            writer.reset();

            expect(save).toHaveBeenLastCalledWith(
                'playlist-1',
                expect.objectContaining({
                    contentXtreamId: 42,
                    positionSeconds: 11,
                })
            );
            // The new playback's resume point is untouched: its latch is
            // closed again and drops the engine's ~0 tick.
            expect(
                writer.handleTimeUpdate({ currentTime: 0, duration: 900 })
            ).toBe(false);
            expect(save).toHaveBeenCalledTimes(2);
        });

        it('writes nothing for a playback that never reached its resume point', () => {
            const { writer, save } = setup({
                ...playbackWithInfo(),
                startTime: 2538,
            });
            writer.handleTimeUpdate({ currentTime: 3, duration: 7744 });

            writer.reset();

            expect(save).not.toHaveBeenCalled();
        });

        it('skips onSaved once the page shows another owner, but still saves', () => {
            const owner = signal('movie-42');
            const save = jest.fn();
            const onSaved = jest.fn();
            const writer = createInlinePlaybackPositionWriter({
                playback: signal(playbackWithInfo()),
                save,
                onSaved,
                ownerKey: owner,
            });
            writer.handleTimeUpdate({ currentTime: 10, duration: 100 });
            writer.handleTimeUpdate({ currentTime: 11, duration: 100 });
            owner.set('movie-7');

            writer.reset();

            expect(save).toHaveBeenLastCalledWith(
                'playlist-1',
                expect.objectContaining({ positionSeconds: 11 })
            );
            expect(onSaved).toHaveBeenCalledTimes(1);
        });
    });

    it('flushes a writer without onSaved, as second-stream slots use it', () => {
        const save = jest.fn();
        const writer = createInlinePlaybackPositionWriter({
            playback: signal(playbackWithInfo()),
            save,
        });
        writer.handleTimeUpdate({ currentTime: 10, duration: 100 });
        writer.handleTimeUpdate({ currentTime: 11, duration: 100 });

        writer.reset();

        expect(save).toHaveBeenLastCalledWith(
            'playlist-1',
            expect.objectContaining({ positionSeconds: 11 })
        );
    });

    describe('pause and page hide', () => {
        it('persists a paused position at once, and only once', () => {
            jest.useFakeTimers();
            const { writer, save } = setup();
            writer.handleTimeUpdate({ currentTime: 600, duration: 7200 });
            jest.advanceTimersByTime(4000);
            writer.handleTimeUpdate({
                currentTime: 604,
                duration: 7200,
                playing: true,
            });

            writer.handleTimeUpdate({
                currentTime: 604.4,
                duration: 7200,
                playing: false,
            });
            writer.handleTimeUpdate({
                currentTime: 604.4,
                duration: 7200,
                playing: false,
            });

            expect(save.mock.calls.map(([, p]) => p.positionSeconds)).toEqual([
                600, 604,
            ]);
        });

        it('persists a seek made while paused', () => {
            jest.useFakeTimers();
            const { writer, save } = setup();
            writer.handleTimeUpdate({
                currentTime: 600,
                duration: 7200,
                playing: false,
            });
            writer.handleTimeUpdate({
                currentTime: 900,
                duration: 7200,
                playing: false,
            });

            expect(save).toHaveBeenLastCalledWith(
                'playlist-1',
                expect.objectContaining({ positionSeconds: 900 })
            );
        });

        it('persists every held position when the page is hidden', () => {
            jest.useFakeTimers();
            const first = setup();
            const second = setup();
            for (const { writer } of [first, second]) {
                writer.handleTimeUpdate({ currentTime: 600, duration: 7200 });
                writer.handleTimeUpdate({ currentTime: 610, duration: 7200 });
            }

            window.dispatchEvent(new Event('pagehide'));

            for (const { save } of [first, second]) {
                expect(save).toHaveBeenLastCalledWith(
                    'playlist-1',
                    expect.objectContaining({ positionSeconds: 610 })
                );
            }
            // Flushed writers leave the page-hide set: nothing is written twice.
            window.dispatchEvent(new Event('pagehide'));
            expect(first.save).toHaveBeenCalledTimes(2);
        });
    });

    it('writes nothing without a playback', () => {
        const { writer, save } = setup(null);

        writer.handleTimeUpdate({ currentTime: 5, duration: 100 });

        expect(save).not.toHaveBeenCalled();
    });

    it('writes nothing without contentInfo — there is no key to store under', () => {
        const { writer, save } = setup({
            streamUrl: 'http://example.com/movie.mkv',
            title: 'Synthetic Feature',
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

        it('saves a verified handoff position below the requested resume point', () => {
            const { writer, save } = setup(resuming(2538));
            expect(
                writer.handleTimeUpdate({ currentTime: 12, duration: 7744 })
            ).toBe(false);

            expect(
                writer.handleTimeUpdate({
                    currentTime: 120,
                    duration: 7744,
                    checkpoint: true,
                })
            ).toBe(true);
            expect(save).toHaveBeenLastCalledWith(
                'playlist-1',
                expect.objectContaining({ positionSeconds: 120 })
            );
        });

        it('persists a final checkpoint inside the ordinary write throttle', () => {
            jest.useFakeTimers();
            const { writer, save } = setup();
            writer.handleTimeUpdate({ currentTime: 10, duration: 100 });
            writer.handleTimeUpdate({
                currentTime: 5,
                duration: 100,
                checkpoint: true,
            });
            expect(save).toHaveBeenCalledTimes(2);
            expect(save).toHaveBeenLastCalledWith(
                'playlist-1',
                expect.objectContaining({ positionSeconds: 5 })
            );
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

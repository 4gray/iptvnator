import {
    clampPlaybackSeek,
    playbackIsLive,
    playbackSeekWindow,
} from './playback-seek-policy';

describe('playback seek policy', () => {
    it.each([false, true])(
        'does not infer live seekability from duration (seekable=%s)',
        (seekable) => {
            expect(
                playbackSeekWindow({
                    isLive: true,
                    position: 20,
                    duration: 120,
                    seekable,
                }).canSeek
            ).toBe(false);
        }
    );
    it('uses only the contiguous live range containing the playhead', () => {
        const input = {
            isLive: true,
            position: 75,
            duration: null,
            ranges: [
                { start: 10, end: 30 },
                { start: 60, end: 90 },
            ],
        };
        const window = playbackSeekWindow(input);
        expect(window).toEqual({ canSeek: true, seekStart: 60, seekEnd: 90 });
        expect(clampPlaybackSeek(window, 0)).toBe(60);
        expect(clampPlaybackSeek(window, 100)).toBe(90);
        expect(clampPlaybackSeek(window, NaN)).toBeNull();
        expect(playbackSeekWindow({ ...input, position: 45 }).canSeek).toBe(
            false
        );
    });
    it('respects explicit VOD seekability and supports older duration-only snapshots', () => {
        const input = { isLive: false, position: 20, duration: 120 };
        expect(playbackSeekWindow(input).canSeek).toBe(true);
        expect(playbackSeekWindow({ ...input, seekable: false }).canSeek).toBe(
            false
        );
        expect(
            playbackSeekWindow({ ...input, duration: Infinity }).canSeek
        ).toBe(false);
    });
    it('rejects invalid positions and negative or inverted ranges', () => {
        expect(
            playbackSeekWindow({ isLive: false, position: NaN, duration: 120 })
                .canSeek
        ).toBe(false);
        expect(
            playbackSeekWindow({
                isLive: true,
                position: 20,
                duration: null,
                ranges: [
                    { start: -1, end: 30 },
                    { start: 30, end: 20 },
                ],
            }).canSeek
        ).toBe(false);
    });
    it('lets explicit media metadata override content classification', () => {
        expect(playbackIsLive({ isLive: false })).toBe(false);
        expect(playbackIsLive({})).toBe(true);
    });
});

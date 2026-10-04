import { floatingPlaybackState as state } from './floating-playback-state';

describe('floating playback seek availability', () => {
    it('allows seeking VOD only when MPV reports seekability and a finite duration', () => {
        expect(state(false, 1, false, 20, 120, true)).toMatchObject({
            canSeek: true,
            seekStart: 0,
            seekEnd: 120,
        });
        expect(state(false, 1, false, 20, 120, false).canSeek).toBe(false);
        expect(state(false, 1, false, 20, null, true).canSeek).toBe(false);
        expect(state(false, 1, false, 20, Infinity, true).canSeek).toBe(false);
    });
    it('does not mistake live duration or estimated buffering for a seek range', () => {
        expect(state(false, 1, true, 20, 120, true).canSeek).toBe(false);
    });
    it('allows live seeking only within the contiguous range containing the playhead', () => {
        const ranges = [
            { start: 10, end: 30 },
            { start: 60, end: 90 },
        ];
        expect(state(false, 1, true, 20, null, false, ranges)).toMatchObject({
            canSeek: true,
            seekStart: 10,
            seekEnd: 30,
        });
        expect(state(false, 1, true, 45, null, false, ranges).canSeek).toBe(
            false
        );
        expect(state(false, 1, true, 75, null, false, ranges)).toMatchObject({
            seekStart: 60,
            seekEnd: 90,
        });
    });
    it('rejects invalid ranges', () => {
        expect(
            state(false, 1, true, 20, null, false, [
                { start: NaN, end: 30 },
                { start: 30, end: 10 },
            ]).canSeek
        ).toBe(false);
    });
});

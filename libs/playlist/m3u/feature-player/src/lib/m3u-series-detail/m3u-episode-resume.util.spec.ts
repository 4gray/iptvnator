import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { resumeOffsetOf } from './m3u-episode-resume.util';

const saved = (
    positionSeconds: unknown,
    durationSeconds?: unknown
): PlaybackPositionData =>
    ({ positionSeconds, durationSeconds }) as PlaybackPositionData;

describe('resumeOffsetOf', () => {
    it('starts from the beginning when nothing usable was saved', () => {
        expect(resumeOffsetOf(undefined)).toBeUndefined();
        expect(resumeOffsetOf(saved(0, 2400))).toBeUndefined();
        expect(resumeOffsetOf(saved(-5, 2400))).toBeUndefined();
        expect(resumeOffsetOf(saved(Number.NaN, 2400))).toBeUndefined();
        expect(resumeOffsetOf(saved('640', 2400))).toBeUndefined();
    });

    it('resumes at the saved second', () => {
        expect(resumeOffsetOf(saved(640, 2400))).toBe(640);
    });

    it('resumes when the duration is unknown or unusable', () => {
        expect(resumeOffsetOf(saved(640))).toBe(640);
        expect(resumeOffsetOf(saved(640, 0))).toBe(640);
        expect(resumeOffsetOf(saved(640, Number.POSITIVE_INFINITY))).toBe(640);
    });

    it('starts a finished episode over rather than at the credits', () => {
        expect(resumeOffsetOf(saved(2390, 2400))).toBeUndefined();
        expect(resumeOffsetOf(saved(2385, 2400))).toBeUndefined();
        expect(resumeOffsetOf(saved(2384, 2400))).toBe(2384);
    });
});

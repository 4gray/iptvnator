import {
    getXtreamCatchupDays,
    isXtreamCatchupAvailable,
} from './xtream-catchup.util';

describe('xtream-catchup.util', () => {
    describe('getXtreamCatchupDays', () => {
        it('returns the numeric archive window', () => {
            expect(
                getXtreamCatchupDays({ tv_archive: 1, tv_archive_duration: 7 })
            ).toBe(7);
        });

        it('parses string durations sent by some panels', () => {
            expect(
                getXtreamCatchupDays({
                    tv_archive: '1',
                    tv_archive_duration: '3',
                })
            ).toBe(3);
        });

        it('returns 0 for absent, null, or unparsable values', () => {
            expect(getXtreamCatchupDays(undefined)).toBe(0);
            expect(getXtreamCatchupDays(null)).toBe(0);
            expect(getXtreamCatchupDays({})).toBe(0);
            expect(
                getXtreamCatchupDays({ tv_archive_duration: null })
            ).toBe(0);
            expect(
                getXtreamCatchupDays({ tv_archive_duration: 'soon' })
            ).toBe(0);
        });

        it('clamps negative durations to 0', () => {
            expect(
                getXtreamCatchupDays({ tv_archive_duration: -2 })
            ).toBe(0);
        });
    });

    describe('isXtreamCatchupAvailable', () => {
        it('requires both the flag and a positive window', () => {
            expect(
                isXtreamCatchupAvailable({
                    tv_archive: 1,
                    tv_archive_duration: 7,
                })
            ).toBe(true);
        });

        it('accepts string field values', () => {
            expect(
                isXtreamCatchupAvailable({
                    tv_archive: '1',
                    tv_archive_duration: '5',
                })
            ).toBe(true);
        });

        it('rejects a flag without a playable window', () => {
            expect(
                isXtreamCatchupAvailable({
                    tv_archive: 1,
                    tv_archive_duration: 0,
                })
            ).toBe(false);
        });

        it('rejects channels without the archive flag', () => {
            expect(
                isXtreamCatchupAvailable({
                    tv_archive: 0,
                    tv_archive_duration: 7,
                })
            ).toBe(false);
            expect(isXtreamCatchupAvailable({})).toBe(false);
            expect(isXtreamCatchupAvailable(null)).toBe(false);
            expect(isXtreamCatchupAvailable(undefined)).toBe(false);
        });
    });
});

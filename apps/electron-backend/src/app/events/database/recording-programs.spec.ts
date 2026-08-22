import {
    decodeRecordingPrograms,
    sanitizeRecordingPrograms,
} from './recording-programs';

describe('sanitizeRecordingPrograms', () => {
    it('fails closed for non-array payloads', () => {
        expect(sanitizeRecordingPrograms(undefined)).toBeNull();
        expect(sanitizeRecordingPrograms(null)).toBeNull();
        expect(sanitizeRecordingPrograms('[]')).toBeNull();
        expect(sanitizeRecordingPrograms({ length: 1 })).toBeNull();
    });

    it('rejects arrays above the hostile-input cap', () => {
        const oversized = Array.from({ length: 65 }, (_, index) => ({
            title: `Program ${index}`,
            start: '2026-08-15T21:00:00+03:00',
            stop: '2026-08-15T22:00:00+03:00',
        }));
        expect(sanitizeRecordingPrograms(oversized)).toBeNull();
    });

    it('drops invalid entries individually and keeps valid ones', () => {
        const sanitized = sanitizeRecordingPrograms([
            {
                title: '  News  ',
                description: ' Daily news ',
                start: '2026-08-15T21:00:00+03:00',
                stop: '2026-08-15T21:45:00+03:00',
            },
            { title: '', start: 'x', stop: 'y' },
            { title: 'No times' },
            42,
            null,
        ]);
        expect(sanitized).toEqual([
            {
                title: 'News',
                description: 'Daily news',
                start: '2026-08-15T21:00:00+03:00',
                stop: '2026-08-15T21:45:00+03:00',
            },
        ]);
    });

    it('omits empty descriptions and truncates oversized fields', () => {
        const sanitized = sanitizeRecordingPrograms([
            {
                title: 'a'.repeat(600),
                description: '   ',
                start: '2026-08-15T21:00:00+03:00',
                stop: '2026-08-15T21:45:00+03:00',
            },
        ]);
        expect(sanitized).toHaveLength(1);
        expect(sanitized?.[0].title).toHaveLength(512);
        expect(sanitized?.[0]).not.toHaveProperty('description');
    });

    it('rejects entries with oversized time strings', () => {
        expect(
            sanitizeRecordingPrograms([
                {
                    title: 'News',
                    start: 'x'.repeat(65),
                    stop: '2026-08-15T21:45:00+03:00',
                },
            ])
        ).toEqual([]);
    });
});

describe('decodeRecordingPrograms', () => {
    it('returns undefined for empty, junk, or non-array JSON', () => {
        expect(decodeRecordingPrograms(null)).toBeUndefined();
        expect(decodeRecordingPrograms('')).toBeUndefined();
        expect(decodeRecordingPrograms('not json')).toBeUndefined();
        expect(decodeRecordingPrograms('{"title":"x"}')).toBeUndefined();
        expect(decodeRecordingPrograms('[]')).toBeUndefined();
    });

    it('decodes and re-sanitizes persisted programs', () => {
        const decoded = decodeRecordingPrograms(
            JSON.stringify([
                {
                    title: 'News',
                    start: '2026-08-15T21:00:00+03:00',
                    stop: '2026-08-15T21:45:00+03:00',
                    injected: 'junk',
                },
            ])
        );
        expect(decoded).toEqual([
            {
                title: 'News',
                start: '2026-08-15T21:00:00+03:00',
                stop: '2026-08-15T21:45:00+03:00',
            },
        ]);
    });
});

import { normalizeEmbeddedMpvChapters } from './embedded-mpv-chapters.util';

describe('normalizeEmbeddedMpvChapters', () => {
    it('keeps valid chapters and trims titles', () => {
        expect(
            normalizeEmbeddedMpvChapters([
                { timeSeconds: 0, title: ' Intro ' },
                { timeSeconds: 12.5 },
                { timeSeconds: 40, title: '' },
            ])
        ).toEqual([
            { timeSeconds: 0, title: 'Intro' },
            { timeSeconds: 12.5 },
            { timeSeconds: 40 },
        ]);
    });

    it('drops malformed entries', () => {
        expect(
            normalizeEmbeddedMpvChapters([
                null,
                'chapter',
                { title: 'No time' },
                { timeSeconds: -1 },
                { timeSeconds: Number.NaN },
                { timeSeconds: '10' },
                { timeSeconds: 5, title: 7 },
            ])
        ).toEqual([{ timeSeconds: 5 }]);
    });

    it('treats a missing field from an older binary as no chapters', () => {
        expect(normalizeEmbeddedMpvChapters(undefined)).toEqual([]);
        expect(normalizeEmbeddedMpvChapters({})).toEqual([]);
    });
});

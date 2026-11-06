import {
    MAX_EMBEDDED_MPV_CHAPTERS,
    MAX_EMBEDDED_MPV_CHAPTER_TITLE_LENGTH,
    normalizeEmbeddedMpvChapters,
} from './embedded-mpv-chapters.util';

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

    it('bounds the chapter count and title length', () => {
        const chapters = normalizeEmbeddedMpvChapters(
            Array.from({ length: MAX_EMBEDDED_MPV_CHAPTERS + 50 }, (_, i) => ({
                timeSeconds: i,
                title: '😀'.repeat(MAX_EMBEDDED_MPV_CHAPTER_TITLE_LENGTH + 5),
            }))
        );

        expect(chapters).toHaveLength(MAX_EMBEDDED_MPV_CHAPTERS);
        expect(chapters.at(-1)?.timeSeconds).toBe(
            MAX_EMBEDDED_MPV_CHAPTERS - 1
        );
        // Cut by code point, so no surrogate pair is split.
        expect(Array.from(chapters[0].title ?? '')).toHaveLength(
            MAX_EMBEDDED_MPV_CHAPTER_TITLE_LENGTH
        );
        expect(chapters[0].title).toBe(
            '😀'.repeat(MAX_EMBEDDED_MPV_CHAPTER_TITLE_LENGTH)
        );
    });

    it('treats a missing field from an older binary as no chapters', () => {
        expect(normalizeEmbeddedMpvChapters(undefined)).toEqual([]);
        expect(normalizeEmbeddedMpvChapters({})).toEqual([]);
    });
});

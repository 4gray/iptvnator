import {
    UP_NEXT_MAX_CREDITS_LEAD_SECONDS,
    type UpNextChapter,
    creditsStartSeconds,
    upNextLeadSeconds,
    upNextThresholdSeconds,
} from './up-next-timing.util';

const chapter = (
    startSeconds: number,
    title: string | null
): UpNextChapter => ({
    startSeconds,
    title,
});

describe('upNextThresholdSeconds', () => {
    it.each([
        [10 * 60, 40],
        [22 * 60, 53],
        [45 * 60, 108],
        [60 * 60, 144],
        [90 * 60, 180],
        [3 * 60 * 60, 180],
    ])('gives a %i s episode a %i s lead', (duration, lead) => {
        expect(upNextThresholdSeconds(duration)).toBe(lead);
    });
});

describe('creditsStartSeconds', () => {
    const duration = 1800;

    it('finds the earliest credits chapter in the last third', () => {
        expect(
            creditsStartSeconds(
                [
                    chapter(0, 'Intro'),
                    chapter(1700, 'Credits'),
                    chapter(1650, 'Outro'),
                ],
                duration
            )
        ).toBe(1650);
    });

    it('recognises anime ending themes and localized titles', () => {
        expect(creditsStartSeconds([chapter(1600, 'ED1')], duration)).toBe(
            1600
        );
        expect(creditsStartSeconds([chapter(1600, 'Abspann')], duration)).toBe(
            1600
        );
    });

    it('ignores untitled chapters and anything before the last third', () => {
        expect(
            creditsStartSeconds(
                [chapter(60, 'Opening credits'), chapter(1700, null)],
                duration
            )
        ).toBeNull();
        expect(creditsStartSeconds(null, duration)).toBeNull();
    });
});

describe('upNextLeadSeconds', () => {
    it('needs a finite, positive duration', () => {
        expect(upNextLeadSeconds({ durationSeconds: null })).toBeNull();
        expect(upNextLeadSeconds({ durationSeconds: 0 })).toBeNull();
        expect(upNextLeadSeconds({ durationSeconds: Infinity })).toBeNull();
        expect(upNextLeadSeconds({ durationSeconds: NaN })).toBeNull();
    });

    it('falls back to the adaptive lead without credits', () => {
        expect(upNextLeadSeconds({ durationSeconds: 22 * 60 })).toBe(53);
        expect(
            upNextLeadSeconds({
                durationSeconds: 22 * 60,
                chapters: [chapter(0, 'Intro')],
            })
        ).toBe(53);
    });

    it('starts at a closing-credits chapter', () => {
        expect(
            upNextLeadSeconds({
                durationSeconds: 1800,
                chapters: [chapter(1680, 'Credits')],
            })
        ).toBe(120);
    });

    it('prefers a supplied credits start over chapters', () => {
        expect(
            upNextLeadSeconds({
                durationSeconds: 1800,
                chapters: [chapter(1680, 'Credits')],
                creditsStartSeconds: 1740,
            })
        ).toBe(60);
    });

    it('ignores a supplied credits start outside the episode', () => {
        for (const creditsStartSeconds of [0, -5, 1800, 2000, NaN]) {
            expect(
                upNextLeadSeconds({
                    durationSeconds: 1800,
                    chapters: [chapter(1680, 'Credits')],
                    creditsStartSeconds,
                })
            ).toBe(120);
        }
    });

    it('caps how far long credits bring the card forward', () => {
        expect(
            upNextLeadSeconds({
                durationSeconds: 3600,
                creditsStartSeconds: 2400,
            })
        ).toBe(UP_NEXT_MAX_CREDITS_LEAD_SECONDS);
    });
});

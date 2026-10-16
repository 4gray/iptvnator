import { repeatsSeriesDescription } from './season-description.util';

const SERIES =
    'Two researchers find a cure. The family fights over it. The eldest son steps in.';

describe('repeatsSeriesDescription', () => {
    it('matches the same text after trimming and whitespace folding', () => {
        expect(repeatsSeriesDescription(`  ${SERIES}\n`, SERIES)).toBe(true);
        expect(
            repeatsSeriesDescription(SERIES.replace(/ /g, '  '), SERIES)
        ).toBe(true);
    });

    it('matches a season text that is the series text cut short', () => {
        expect(
            repeatsSeriesDescription(
                'Two researchers find a cure. The family fights over it.',
                SERIES
            )
        ).toBe(true);
        expect(repeatsSeriesDescription(`${SERIES} More.`, SERIES)).toBe(true);
    });

    it('keeps a season synopsis of its own', () => {
        expect(
            repeatsSeriesDescription('The second season moves abroad.', SERIES)
        ).toBe(false);
    });

    it('never hides a description against a missing series description', () => {
        expect(repeatsSeriesDescription(SERIES, null)).toBe(false);
        expect(repeatsSeriesDescription(SERIES, '   ')).toBe(false);
        expect(repeatsSeriesDescription('', SERIES)).toBe(false);
    });
});

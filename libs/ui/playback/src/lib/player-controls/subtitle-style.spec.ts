import {
    DEFAULT_SUBTITLE_STYLE,
    SUBTITLE_STYLE_STORAGE_KEY,
    clampSubtitleDelay,
    isDefaultSubtitleStyle,
    normalizeSubtitleStyle,
    persistSubtitleStyle,
    readStoredSubtitleStyle,
    subtitleDelayLabel,
} from './subtitle-style';

describe('subtitle-style', () => {
    afterEach(() => {
        localStorage.clear();
    });

    describe('clampSubtitleDelay', () => {
        it('clamps to the ±60 s window and rejects non-finite values', () => {
            expect(clampSubtitleDelay(1.5)).toBe(1.5);
            expect(clampSubtitleDelay(500)).toBe(60);
            expect(clampSubtitleDelay(-500)).toBe(-60);
            expect(clampSubtitleDelay(Number.NaN)).toBe(0);
            expect(clampSubtitleDelay(Number.POSITIVE_INFINITY)).toBe(0);
        });

        it('rounds away float drift from repeated 0.5 steps', () => {
            expect(clampSubtitleDelay(0.1 + 0.2)).toBe(0.3);
        });
    });

    describe('normalizeSubtitleStyle', () => {
        it('returns the default for junk input', () => {
            expect(normalizeSubtitleStyle(null)).toEqual(
                DEFAULT_SUBTITLE_STYLE
            );
            expect(normalizeSubtitleStyle('big')).toEqual(
                DEFAULT_SUBTITLE_STYLE
            );
            expect(
                normalizeSubtitleStyle({ sizePercent: 'x', color: 42 })
            ).toEqual(DEFAULT_SUBTITLE_STYLE);
        });

        it('clamps the size and validates the color format', () => {
            expect(
                normalizeSubtitleStyle({ sizePercent: 1000, color: '#FFE94F' })
            ).toEqual({ sizePercent: 400, color: '#ffe94f' });
            expect(
                normalizeSubtitleStyle({ sizePercent: 5, color: 'red' })
            ).toEqual({ sizePercent: 25, color: null });
        });
    });

    describe('persistence', () => {
        it('round-trips a non-default style through localStorage', () => {
            persistSubtitleStyle({ sizePercent: 150, color: '#ffffff' });
            expect(readStoredSubtitleStyle()).toEqual({
                sizePercent: 150,
                color: '#ffffff',
            });
        });

        it('removes the stored value when the style returns to default', () => {
            persistSubtitleStyle({ sizePercent: 150, color: null });
            persistSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE });
            expect(
                localStorage.getItem(SUBTITLE_STYLE_STORAGE_KEY)
            ).toBeNull();
            expect(readStoredSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE);
        });

        it('falls back to the default for corrupted stored values', () => {
            localStorage.setItem(SUBTITLE_STYLE_STORAGE_KEY, '{not json');
            expect(readStoredSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE);
        });
    });

    describe('isDefaultSubtitleStyle', () => {
        it('detects the default and non-default styles', () => {
            expect(isDefaultSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE })).toBe(
                true
            );
            expect(
                isDefaultSubtitleStyle({ sizePercent: 100, color: '#ffffff' })
            ).toBe(false);
            expect(
                isDefaultSubtitleStyle({ sizePercent: 125, color: null })
            ).toBe(false);
        });
    });

    describe('subtitleDelayLabel', () => {
        it('formats zero, positive, and negative delays', () => {
            expect(subtitleDelayLabel(0)).toBe('0 s');
            expect(subtitleDelayLabel(0.5)).toBe('+0.5 s');
            expect(subtitleDelayLabel(-1.5)).toBe('−1.5 s');
        });
    });
});

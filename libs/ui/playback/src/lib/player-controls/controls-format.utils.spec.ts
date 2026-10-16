import {
    formatRemainingTime,
    formatTime,
    persistVolume,
    readStoredVolume,
    volumeIcon,
    volumeLabel,
} from './controls-format.utils';

describe('controls format utilities', () => {
    afterEach(() => {
        localStorage.clear();
    });

    it('formats playback time with hour rollover and safe null values', () => {
        expect(formatTime(null)).toBe('0:00');
        expect(formatTime(-30)).toBe('0:00');
        expect(formatTime(75.9)).toBe('1:15');
        expect(formatTime(3661)).toBe('1:01:01');
    });

    it('formats the remaining time with a minus sign, rounding up', () => {
        expect(formatRemainingTime(30, 600)).toBe('−9:30');
        expect(formatRemainingTime(599.2, 600)).toBe('−0:01');
        expect(formatRemainingTime(700, 600)).toBe('−0:00');
        expect(formatRemainingTime(-5, 60)).toBe('−1:00');
    });

    it('has no remaining time without a finite positive duration', () => {
        expect(formatRemainingTime(30, null)).toBeNull();
        expect(formatRemainingTime(30, undefined)).toBeNull();
        expect(formatRemainingTime(30, 0)).toBeNull();
        expect(formatRemainingTime(30, Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('clamps stored volume reads and persists raw volume values', () => {
        localStorage.setItem('volume', '2');
        expect(readStoredVolume()).toBe(1);

        localStorage.setItem('volume', '-0.5');
        expect(readStoredVolume()).toBe(0);

        localStorage.setItem('volume', 'not-a-number');
        expect(readStoredVolume()).toBe(1);

        persistVolume(0.35);
        expect(localStorage.getItem('volume')).toBe('0.35');
    });

    it('maps volume to an icon and a readable label', () => {
        expect(volumeIcon(0)).toBe('volume_off');
        expect(volumeIcon(0.25)).toBe('volume_down');
        expect(volumeIcon(0.75)).toBe('volume_up');
        expect(volumeLabel(0.755)).toBe('Volume 76%');
    });
});

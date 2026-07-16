import {
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

import {
    aspectLabel,
    audioTrackLabel,
    formatTime,
    measureBounds,
    persistVolume,
    readStoredVolume,
    subtitleTrackLabel,
    volumeIcon,
    volumeLabel,
} from './embedded-mpv-format.utils';

describe('embedded MPV format utilities', () => {
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

    it('builds readable labels for tracks, aspects, and volume', () => {
        expect(
            audioTrackLabel(
                {
                    id: 1,
                    language: 'eng',
                    selected: false,
                    defaultTrack: true,
                },
                0
            )
        ).toContain('Default');
        expect(
            subtitleTrackLabel({ id: 2, selected: false }, 1)
        ).toContain('Subtitle 2');
        expect(aspectLabel('16:9')).toBe('16:9');
        expect(aspectLabel('custom')).toBe('custom');
        expect(volumeIcon(0)).toBe('volume_off');
        expect(volumeIcon(0.25)).toBe('volume_down');
        expect(volumeIcon(0.75)).toBe('volume_up');
        expect(volumeLabel(0.755)).toBe('Volume 76%');
    });

    it('rounds host bounds and keeps minimum native view dimensions', () => {
        const host = {
            getBoundingClientRect: () => ({
                left: 10.4,
                top: 20.6,
                width: 0,
                height: 0.2,
            }),
        } as HTMLElement;

        expect(measureBounds(host)).toEqual({
            x: 10,
            y: 21,
            width: 1,
            height: 1,
        });
    });
});

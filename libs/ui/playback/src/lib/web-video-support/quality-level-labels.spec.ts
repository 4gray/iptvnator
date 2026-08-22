import { buildQualityLevelLabels } from './quality-level-labels';

describe('buildQualityLevelLabels', () => {
    it('labels levels by frame height', () => {
        expect(
            buildQualityLevelLabels([
                { height: 1080, width: 1920, bitrate: 8_000_000 },
                { height: 720, width: 1280, bitrate: 4_000_000 },
                { height: 480, width: 854, bitrate: 1_500_000 },
            ])
        ).toEqual(['1080p', '720p', '480p']);
    });

    it('projects a 16:9 height from a width-only level', () => {
        expect(buildQualityLevelLabels([{ width: 1920 }])).toEqual(['1080p']);
    });

    it('falls back to the bitrate and then to a positional label', () => {
        expect(
            buildQualityLevelLabels([
                { bitrate: 4_500_000 },
                { bitrate: 640_000 },
                {},
            ])
        ).toEqual(['4.5 Mbps', '640 kbps', 'Level 3']);
    });

    it('rounds Mbps values at 10 and above to whole numbers', () => {
        expect(buildQualityLevelLabels([{ bitrate: 15_400_000 }])).toEqual([
            '15 Mbps',
        ]);
    });

    it('disambiguates same-height levels with their bitrates', () => {
        expect(
            buildQualityLevelLabels([
                { height: 1080, bitrate: 8_000_000 },
                { height: 1080, bitrate: 4_000_000 },
                { height: 720, bitrate: 2_000_000 },
            ])
        ).toEqual(['1080p (8.0 Mbps)', '1080p (4.0 Mbps)', '720p']);
    });

    it('keeps colliding labels plain when no bitrate can disambiguate', () => {
        expect(
            buildQualityLevelLabels([{ height: 1080 }, { height: 1080 }])
        ).toEqual(['1080p', '1080p']);
    });

    it('ignores non-finite and non-positive facts', () => {
        expect(
            buildQualityLevelLabels([
                { height: 0, width: NaN, bitrate: -5 },
                { height: null, width: null, bitrate: null },
            ])
        ).toEqual(['Level 1', 'Level 2']);
    });
});

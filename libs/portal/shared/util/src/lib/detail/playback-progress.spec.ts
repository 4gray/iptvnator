import {
    formatDurationLabel,
    formatRemainingLabel,
    parseDurationSeconds,
    playbackProgressPercent,
} from './playback-progress';

import { inlineProgressPosition } from './playback-progress';

describe('inlineProgressPosition', () => {
    it('writes floored seconds onto the content identity', () => {
        expect(
            inlineProgressPosition(
                {
                    playlistId: 'p1',
                    contentXtreamId: 7,
                    contentType: 'episode',
                },
                { currentTime: 61.9, duration: 1800.2 }
            )
        ).toEqual({
            playlistId: 'p1',
            contentXtreamId: 7,
            contentType: 'episode',
            positionSeconds: 61,
            durationSeconds: 1800,
        });
    });
});

describe('playbackProgressPercent', () => {
    it('floors the watched share to an integer percent', () => {
        expect(
            playbackProgressPercent({
                positionSeconds: 924,
                durationSeconds: 1000,
            })
        ).toBe(92);
    });

    it('returns null without a duration', () => {
        expect(playbackProgressPercent({ positionSeconds: 10 })).toBeNull();
        expect(playbackProgressPercent(null)).toBeNull();
    });
});

describe('formatRemainingLabel', () => {
    it('picks seconds, minutes, hours and hours+minutes', () => {
        expect(
            formatRemainingLabel({ positionSeconds: 70, durationSeconds: 100 })
        ).toEqual({
            key: 'WORKSPACE.DASHBOARD.REMAINING_SECONDS',
            params: { seconds: 30 },
        });
        expect(
            formatRemainingLabel({
                positionSeconds: 600,
                durationSeconds: 1920,
            })
        ).toEqual({
            key: 'WORKSPACE.DASHBOARD.REMAINING_MINUTES',
            params: { minutes: 22 },
        });
        expect(
            formatRemainingLabel({ positionSeconds: 0, durationSeconds: 7200 })
        ).toEqual({
            key: 'WORKSPACE.DASHBOARD.REMAINING_HOURS',
            params: { hours: 2 },
        });
        expect(
            formatRemainingLabel({ positionSeconds: 60, durationSeconds: 3960 })
        ).toEqual({
            key: 'WORKSPACE.DASHBOARD.REMAINING_HOURS_MINUTES',
            params: { hours: 1, minutes: 5 },
        });
    });

    it('returns null without a duration', () => {
        expect(formatRemainingLabel({ positionSeconds: 5 })).toBeNull();
    });
});

describe('formatDurationLabel', () => {
    it('formats minutes and hours', () => {
        expect(formatDurationLabel(48 * 60)).toEqual({
            key: 'PORTALS.DETAIL.DURATION_MINUTES',
            params: { minutes: 48 },
        });
        expect(formatDurationLabel(6720)).toEqual({
            key: 'PORTALS.DETAIL.DURATION_HOURS_MINUTES',
            params: { hours: 1, minutes: 52 },
        });
    });

    it('returns null for unknown durations', () => {
        expect(formatDurationLabel(0)).toBeNull();
        expect(formatDurationLabel(undefined)).toBeNull();
    });
});

describe('parseDurationSeconds', () => {
    it.each([
        ['45 min', 2700],
        ['1h 30min', 5400],
        ['01:52:10', 6730],
        ['52:10', 3130],
        ['90', 90],
        [120, 120],
        ['', 0],
        [undefined, 0],
    ])('parses %p', (input, expected) => {
        expect(parseDurationSeconds(input)).toBe(expected);
    });
});

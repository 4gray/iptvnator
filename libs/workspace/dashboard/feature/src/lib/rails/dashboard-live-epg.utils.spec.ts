import type { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    buildDashboardLiveEpgDetails,
    formatEpgTimeRange,
} from './dashboard-live-epg.utils';

const HOUR_MS = 60 * 60_000;
// Local 12:00 so the HH:mm expectations below are timezone-independent.
const START = new Date(2026, 5, 28, 12, 0, 0, 0).getTime();
const NOW = START + HOUR_MS / 2; // 12:30
const program: EpgProgram = {
    start: new Date(START).toISOString(),
    stop: new Date(START + HOUR_MS).toISOString(),
    channel: 'ch',
    title: 'Noon Show',
    desc: null,
    category: null,
};

describe('dashboard-live-epg.utils', () => {
    it('formats the range and progress in wall-clock terms by default', () => {
        expect(formatEpgTimeRange(program)).toBe('12:00 – 13:00');
        expect(buildDashboardLiveEpgDetails(program, NOW)).toEqual({
            nowPlayingTitle: 'Noon Show',
            nowPlayingTimeRange: '12:00 – 13:00',
            nowPlayingProgress: 50,
        });
    });

    it('shifts the label and measures progress in the provider clock with a display offset', () => {
        // Offset +60: the guide runs an hour ahead, so the 12:00 row really
        // airs 13:00–14:00 and at 12:30 has not started yet.
        expect(formatEpgTimeRange(program, 60)).toBe('13:00 – 14:00');
        expect(buildDashboardLiveEpgDetails(program, NOW, 60)).toEqual({
            nowPlayingTitle: 'Noon Show',
            nowPlayingTimeRange: '13:00 – 14:00',
            nowPlayingProgress: 0,
        });
        // Offset -30: it really started at 11:30 and is two thirds through.
        expect(
            buildDashboardLiveEpgDetails(program, NOW, -30)?.nowPlayingProgress
        ).toBe(100);
    });
});

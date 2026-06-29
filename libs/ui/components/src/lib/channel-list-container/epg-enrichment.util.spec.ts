import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import {
    buildChannelEpgMetadataMap,
    calculateEpgProgress,
    resolveChannelEpgProgram,
} from './epg-enrichment.util';

const BASE = Date.UTC(2026, 0, 1, 12, 0, 0); // 12:00
const NOW = Date.UTC(2026, 0, 1, 12, 30, 0); // 12:30

function program(startOffsetMin: number, durationMin: number): EpgProgram {
    const start = BASE + startOffsetMin * 60_000;
    return {
        start: new Date(start).toISOString(),
        stop: new Date(start + durationMin * 60_000).toISOString(),
        channel: 'ch',
        title: 'P',
        desc: null,
        category: null,
    };
}

describe('epg-enrichment.util', () => {
    describe('calculateEpgProgress', () => {
        it('returns 0 for a missing programme', () => {
            expect(calculateEpgProgress(null, NOW)).toBe(0);
            expect(calculateEpgProgress(undefined, NOW)).toBe(0);
        });

        it('returns a rounded mid-programme percentage', () => {
            // 12:00–13:00, now 12:30 → 50%
            expect(calculateEpgProgress(program(0, 60), NOW)).toBe(50);
            // 12:00–13:30, now 12:30 → 33.33 → 33 (integer)
            const v = calculateEpgProgress(program(0, 90), NOW);
            expect(v).toBe(33);
            expect(Number.isInteger(v)).toBe(true);
        });

        it('clamps to [0, 100] for future and finished programmes', () => {
            expect(calculateEpgProgress(program(60, 60), NOW)).toBe(0); // 13:00–14:00
            expect(calculateEpgProgress(program(-120, 60), NOW)).toBe(100); // 10:00–11:00
        });

        it('never returns NaN for zero-length or invalid timestamps', () => {
            expect(calculateEpgProgress(program(0, 0), NOW)).toBe(0);
            expect(
                calculateEpgProgress(
                    { ...program(0, 60), start: 'nope', stop: 'nope' },
                    NOW
                )
            ).toBe(0);
        });
    });

    describe('resolveChannelEpgProgram', () => {
        const channel = {
            name: 'My Channel',
            tvg: { id: '', name: '' },
        } as unknown as Channel;

        it('returns the programme for the channel lookup key', () => {
            const p = program(0, 60);
            const map = new Map<string, EpgProgram | null>([['My Channel', p]]);
            expect(resolveChannelEpgProgram(channel, map)).toBe(p);
        });

        it('returns null when the channel has no map entry', () => {
            expect(resolveChannelEpgProgram(channel, new Map())).toBeNull();
        });
    });

    describe('buildChannelEpgMetadataMap', () => {
        it('maps each entry to {epgProgram, progressPercentage}', () => {
            const p = program(0, 60);
            const map = new Map<string, EpgProgram | null>([
                ['a', p],
                ['b', null],
            ]);
            const result = buildChannelEpgMetadataMap(map, NOW);
            expect(result.get('a')).toEqual({
                epgProgram: p,
                progressPercentage: 50,
            });
            expect(result.get('b')).toEqual({
                epgProgram: null,
                progressPercentage: 0,
            });
        });
    });
});

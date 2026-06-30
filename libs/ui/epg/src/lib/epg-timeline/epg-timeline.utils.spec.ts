import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    buildTimelineAxis,
    buildTimelineBlocks,
    buildTimelineDayDividers,
    buildTimelineRenderItems,
    buildTimelineTicks,
    classifyTimelineWhen,
    dayKeyAtOffset,
    hasProgramsForDateKey,
    nearestDateKeyWithPrograms,
    TIMELINE_MINUTE_MS,
    TIMELINE_MIN_BLOCK_WIDTH_PX,
    TimelineRenderBlock,
    TimelineRenderGroup,
    tierFor,
    timelineTickStepForScale,
} from './epg-timeline.utils';

function localIso(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute = 0
): string {
    return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function program(start: string, stop: string, title = 'P'): EpgProgram {
    return {
        start,
        stop,
        channel: 'ch',
        title,
        desc: null,
        category: null,
    };
}

const NOW = new Date(2026, 5, 28, 12, 0, 0, 0).getTime(); // 28 Jun 2026, 12:00 local

describe('epg-timeline.utils', () => {
    describe('buildTimelineAxis', () => {
        it('spans from the earliest start to the day after the latest stop', () => {
            const programs = [
                program(localIso(2026, 6, 27, 22), localIso(2026, 6, 28, 0)),
                program(localIso(2026, 6, 29, 20), localIso(2026, 6, 29, 23)),
            ];

            const axis = buildTimelineAxis(programs, NOW);

            expect(new Date(axis.startMs).getDate()).toBe(27);
            expect(new Date(axis.startMs).getHours()).toBe(0);
            // end is local midnight strictly after the last stop (30 Jun 00:00)
            expect(new Date(axis.endMs).getDate()).toBe(30);
            expect(new Date(axis.endMs).getHours()).toBe(0);
        });

        it('always includes the current day even without programmes', () => {
            const axis = buildTimelineAxis([], NOW);
            expect(axis.startMs).toBeLessThanOrEqual(NOW);
            expect(axis.endMs).toBeGreaterThan(NOW);
        });
    });

    describe('classifyTimelineWhen', () => {
        it('classifies past, now and future relative to now', () => {
            expect(classifyTimelineWhen(NOW - 7200000, NOW - 3600000, NOW)).toBe(
                'past'
            );
            expect(classifyTimelineWhen(NOW - 60000, NOW + 60000, NOW)).toBe(
                'now'
            );
            expect(classifyTimelineWhen(NOW + 3600000, NOW + 7200000, NOW)).toBe(
                'future'
            );
        });
    });

    describe('buildTimelineBlocks', () => {
        it('positions blocks by minute offset and drops invalid rows', () => {
            const programs = [
                program(localIso(2026, 6, 28, 11), localIso(2026, 6, 28, 13)),
                program('not-a-date', 'still-not'),
            ];
            const axis = buildTimelineAxis(programs, NOW);
            const blocks = buildTimelineBlocks(programs, axis, NOW);

            expect(blocks).toHaveLength(1);
            const block = blocks[0];
            expect(block.when).toBe('now');
            expect(block.durationMin).toBe(120);
            const expectedOffset = (block.startMs - axis.startMs) / TIMELINE_MINUTE_MS;
            expect(block.offsetMin).toBeCloseTo(expectedOffset, 5);
        });

        it('sorts blocks chronologically', () => {
            const programs = [
                program(localIso(2026, 6, 28, 18), localIso(2026, 6, 28, 19), 'late'),
                program(localIso(2026, 6, 28, 8), localIso(2026, 6, 28, 9), 'early'),
            ];
            const axis = buildTimelineAxis(programs, NOW);
            const blocks = buildTimelineBlocks(programs, axis, NOW);
            expect(blocks.map((b) => b.program.title)).toEqual(['early', 'late']);
        });
    });

    describe('ticks and dividers', () => {
        it('emits a day divider per local midnight and skips midnight ticks', () => {
            const programs = [
                program(localIso(2026, 6, 28, 1), localIso(2026, 6, 28, 23)),
            ];
            const axis = buildTimelineAxis(programs, NOW);
            const dividers = buildTimelineDayDividers(axis);
            const ticks = buildTimelineTicks(axis);

            // single day window → exactly one divider (the day start)
            expect(dividers).toHaveLength(1);
            expect(new Date(dividers[0].dayMs).getHours()).toBe(0);
            // no tick lands on local midnight
            expect(
                ticks.every((t) => new Date(t.ms).getHours() % 2 === 0)
            ).toBe(true);
            expect(ticks.some((t) => new Date(t.ms).getHours() === 0)).toBe(
                false
            );
        });
    });

    describe('date helpers', () => {
        it('reports whether a date key has programmes', () => {
            const programs = [
                program(localIso(2026, 6, 28, 10), localIso(2026, 6, 28, 11)),
            ];
            expect(hasProgramsForDateKey(programs, '2026-06-28')).toBe(true);
            expect(hasProgramsForDateKey(programs, '2026-06-29')).toBe(false);
        });

        it('counts a midnight-spanning programme for both days (overlap, not start-date)', () => {
            // 29 Jun 23:10 → 30 Jun 02:14: airing past midnight. A start-date
            // check would key it to the 29th only, so "today" (the 30th) wrongly
            // fell back to the empty-day state while it was on air.
            const programs = [
                program(
                    localIso(2026, 6, 29, 23, 10),
                    localIso(2026, 6, 30, 2, 14)
                ),
            ];
            expect(hasProgramsForDateKey(programs, '2026-06-29')).toBe(true);
            expect(hasProgramsForDateKey(programs, '2026-06-30')).toBe(true);
            expect(hasProgramsForDateKey(programs, '2026-06-28')).toBe(false);
            expect(hasProgramsForDateKey(programs, '2026-07-01')).toBe(false);
        });

        it('treats the day boundary as exclusive at the end', () => {
            // ends exactly at the 29th 00:00 → belongs to the 28th, not the 29th.
            const programs = [
                program(localIso(2026, 6, 28, 22), localIso(2026, 6, 29, 0)),
            ];
            expect(hasProgramsForDateKey(programs, '2026-06-28')).toBe(true);
            expect(hasProgramsForDateKey(programs, '2026-06-29')).toBe(false);
        });

        it('maps an axis offset back to a local day key', () => {
            const axis = buildTimelineAxis(
                [program(localIso(2026, 6, 28, 10), localIso(2026, 6, 28, 11))],
                NOW
            );
            const offsetForNoon = (12 * 60 * TIMELINE_MINUTE_MS) / TIMELINE_MINUTE_MS;
            expect(dayKeyAtOffset(axis, offsetForNoon)).toBe('2026-06-28');
        });

        it('finds the nearest day with programmes', () => {
            const programs = [
                program(localIso(2026, 6, 25, 10), localIso(2026, 6, 25, 11)),
                program(localIso(2026, 6, 30, 10), localIso(2026, 6, 30, 11)),
            ];
            // Jun 30 10:00 (~1d22h away) is closer to Jun 28 12:00 than Jun 25.
            expect(nearestDateKeyWithPrograms(programs, NOW)).toBe('2026-06-30');
        });
    });

    describe('short-programme strategy', () => {
        it('classifies content tiers by rendered width', () => {
            expect(tierFor(200)).toBe('wide');
            expect(tierFor(90)).toBe('med');
            expect(tierFor(40)).toBe('narrow');
            expect(tierFor(12)).toBe('micro');
        });

        it('densifies tick spacing as the user zooms in', () => {
            expect(timelineTickStepForScale(1)).toBe(120);
            expect(timelineTickStepForScale(2.5)).toBe(60);
            expect(timelineTickStepForScale(4)).toBe(30);
            expect(timelineTickStepForScale(6)).toBe(15);
        });

        function blocksFor(durations: number[]): ReturnType<typeof buildTimelineBlocks> {
            let startMin = 6 * 60; // 06:00
            const programs = durations.map((dur) => {
                const p = program(
                    localIso(2026, 6, 28, Math.floor(startMin / 60), startMin % 60),
                    localIso(
                        2026,
                        6,
                        28,
                        Math.floor((startMin + dur) / 60),
                        (startMin + dur) % 60
                    )
                );
                startMin += dur;
                return p;
            });
            const axis = buildTimelineAxis(programs, NOW);
            return buildTimelineBlocks(programs, axis, NOW);
        }

        it('enforces a minimum width so short programmes stay clickable', () => {
            const blocks = blocksFor([5, 200]); // a 5-min sliver + a long block
            const items = buildTimelineRenderItems(blocks, 1, {
                nowMs: NOW,
            }) as TimelineRenderBlock[];
            // 5 min * scale 1 = 5px raw, floored to the min-width minus gap.
            expect(items[0].widthPx).toBeGreaterThanOrEqual(
                TIMELINE_MIN_BLOCK_WIDTH_PX - 8
            );
            expect(items[0].tier).toBe('narrow');
            // the long block (200px) keeps its full proportional content
            expect(items[1].tier).toBe('wide');
        });

        it('groups >=4 consecutive shorts when grouping is allowed', () => {
            const blocks = blocksFor([5, 5, 5, 5, 120]);
            const grouped = buildTimelineRenderItems(blocks, 1, {
                allowGroup: true,
                nowMs: NOW,
            });
            const group = grouped.find(
                (i): i is TimelineRenderGroup => i.kind === 'group'
            );
            expect(group).toBeDefined();
            expect(group?.count).toBe(4);
            // the long programme stays an individual block
            expect(grouped.filter((i) => i.kind === 'block')).toHaveLength(1);
        });

        it('keeps the on-air programme out of a short-run group chip', () => {
            // Four past 5-min shorts then the on-air short. The old behaviour
            // folded all five into one chip and lost the `when: 'now'` highlight.
            const mk = (
                sh: number,
                sm: number,
                eh: number,
                em: number
            ): ReturnType<typeof program> =>
                program(localIso(2026, 6, 28, sh, sm), localIso(2026, 6, 28, eh, em));
            const programs = [
                mk(11, 38, 11, 43),
                mk(11, 43, 11, 48),
                mk(11, 48, 11, 53),
                mk(11, 53, 11, 58),
                mk(11, 58, 12, 3), // on air — NOW is 12:00
            ];
            const axis = buildTimelineAxis(programs, NOW);
            const blocks = buildTimelineBlocks(programs, axis, NOW);
            const items = buildTimelineRenderItems(blocks, 1, {
                allowGroup: true,
                nowMs: NOW,
            });

            const group = items.find(
                (i): i is TimelineRenderGroup => i.kind === 'group'
            );
            expect(group?.count).toBe(4); // the four past shorts still group
            const nowBlock = items.find(
                (i): i is TimelineRenderBlock =>
                    i.kind === 'block' && i.block.when === 'now'
            );
            expect(nowBlock).toBeDefined(); // on-air short stays a standalone block
        });

        it('does not group when grouping is disallowed (zoomed in)', () => {
            const blocks = blocksFor([5, 5, 5, 5, 120]);
            const items = buildTimelineRenderItems(blocks, 4, {
                allowGroup: false,
                nowMs: NOW,
            });
            expect(items.every((i) => i.kind === 'block')).toBe(true);
            expect(items).toHaveLength(5);
        });

        it('flags catch-up only for past blocks inside the archive window', () => {
            const blocks = blocksFor([120]).map((b) => ({
                ...b,
                when: 'past' as const,
            }));
            const withArchive = buildTimelineRenderItems(blocks, 1, {
                nowMs: NOW,
                archivePlaybackAvailable: true,
                archiveWindowStartMs: Number.NEGATIVE_INFINITY,
            }) as TimelineRenderBlock[];
            expect(withArchive[0].canCatchUp).toBe(true);

            const noArchive = buildTimelineRenderItems(blocks, 1, {
                nowMs: NOW,
                archivePlaybackAvailable: false,
            }) as TimelineRenderBlock[];
            expect(noArchive[0].canCatchUp).toBe(false);
        });
    });
});

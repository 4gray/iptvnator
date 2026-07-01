import { EpgProgram } from '@iptvnator/shared/interfaces';
import { buildEpgListRows } from './epg-list-view.utils';

// Anchor "now" at local noon so ±3h fixtures stay inside the same local day,
// keeping the overlap-based day filter deterministic regardless of run time.
const NOON = new Date();
NOON.setHours(12, 0, 0, 0);
const NOW = NOON.getTime();

function programAt(
    startOffsetMin: number,
    durationMin: number,
    title = 'P',
    extra: Partial<EpgProgram> = {}
): EpgProgram {
    const start = new Date(NOW + startOffsetMin * 60_000);
    const stop = new Date(start.getTime() + durationMin * 60_000);
    return {
        start: start.toISOString(),
        stop: stop.toISOString(),
        channel: 'ch',
        title,
        desc: null,
        category: null,
        ...extra,
    };
}

function dayKey(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TODAY = dayKey(NOW);
const DEFAULT_OPTS = {
    archivePlaybackAvailable: false,
    archiveDays: 0,
    activeProgram: null,
};

describe('buildEpgListRows', () => {
    it('keeps only programmes overlapping the selected day, sorted by start', () => {
        const rows = buildEpgListRows(
            [
                programAt(90, 60, 'Later'),
                programAt(-30, 60, 'Now'),
                programAt(3 * 1440, 60, 'ThreeDaysOut'),
            ],
            TODAY,
            NOW,
            DEFAULT_OPTS
        );

        expect(rows.map((r) => r.program.title)).toEqual(['Now', 'Later']);
    });

    it('classifies past / now / future relative to nowMs', () => {
        const rows = buildEpgListRows(
            [
                programAt(-180, 60, 'Past'),
                programAt(-30, 60, 'Now'),
                programAt(120, 60, 'Future'),
            ],
            TODAY,
            NOW,
            DEFAULT_OPTS
        );

        expect(rows.map((r) => r.when)).toEqual(['past', 'now', 'future']);
    });

    it('computes live progress only for the now row', () => {
        const rows = buildEpgListRows(
            [programAt(-30, 60, 'Now'), programAt(120, 60, 'Future')],
            TODAY,
            NOW,
            DEFAULT_OPTS
        );

        const now = rows.find((r) => r.when === 'now');
        const future = rows.find((r) => r.when === 'future');
        expect(now?.progress).toBeGreaterThan(40);
        expect(now?.progress).toBeLessThan(60);
        expect(future?.progress).toBeNull();
    });

    it('gates catch-up on archive availability + window', () => {
        const past = [programAt(-180, 60, 'Past')];

        const withArchive = buildEpgListRows(past, TODAY, NOW, {
            archivePlaybackAvailable: true,
            archiveDays: 7,
            activeProgram: null,
        });
        expect(withArchive[0].canCatchUp).toBe(true);

        const noArchive = buildEpgListRows(past, TODAY, NOW, DEFAULT_OPTS);
        expect(noArchive[0].canCatchUp).toBe(false);
    });

    it('marks the active programme', () => {
        const active = programAt(-180, 60, 'Past');
        const rows = buildEpgListRows(
            [active, programAt(-30, 60, 'Now')],
            TODAY,
            NOW,
            {
                archivePlaybackAvailable: true,
                archiveDays: 7,
                activeProgram: active,
            }
        );

        expect(rows.find((r) => r.program.title === 'Past')?.isActive).toBe(
            true
        );
        expect(rows.find((r) => r.program.title === 'Now')?.isActive).toBe(
            false
        );
    });

    it('deduplicates programmes sharing a time slot, keeping the richer one', () => {
        const rows = buildEpgListRows(
            [
                programAt(-30, 60, 'Now'),
                programAt(-30, 60, 'Now', { desc: 'With description' }),
            ],
            TODAY,
            NOW,
            DEFAULT_OPTS
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].program.desc).toBe('With description');
    });
});

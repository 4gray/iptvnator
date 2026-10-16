import {
    M3U_CATALOG_INDEX_BUDGET_RATIO,
    M3U_SERIES_CATALOG_BUDGET_RATIO,
    REAL_PLAYLIST_ROW_COUNT,
    SyntheticCatalogRow,
    createSyntheticCatalogRows,
    runCatalogReferencePass,
} from './m3u-catalog-index.spec-data';
import { buildM3uCatalogIndex } from './m3u-catalog-index.util';
import { buildM3uSeriesCatalog } from './m3u-series-aggregate.util';

/**
 * The index is built synchronously on the UI thread when a playlist route
 * loads, so its cost is a visible stall rather than a background detail.
 * This spec is the guard that keeps it one.
 *
 * It asserts a ceiling rather than a precise number: CI runners are shared
 * and noisy, and a spec that fails on scheduling jitter gets muted, which
 * is worse than no spec. The ceiling is a ratio to a reference pass timed
 * alongside (see the spec data), so it means the same on a laptop and on a
 * runner several times slower. It is still tight enough to fail on the
 * regressions that actually matter — an extra pass over the rows, a per-row
 * `new URL`, or a channel→kind map.
 *
 * The cost is this process's CPU time, not wall-clock time. Nx runs test
 * targets in parallel and jest runs suites in parallel workers, so on a
 * loaded runner a wall-clock sample mostly measures time spent waiting for
 * a core: the same build measured 454 ms against a 300 ms budget under
 * three parallel targets and passed alone. CPU time excludes that wait and
 * still grows with every extra pass the code makes.
 */
function cpuMs(work: () => void): number {
    const started = process.cpuUsage();
    work();
    const { user, system } = process.cpuUsage(started);
    return (user + system) / 1000;
}

describe('buildM3uCatalogIndex performance', () => {
    const rows = createSyntheticCatalogRows();

    /** Median of three: the first run pays for JIT warm-up on the regexes. */
    function medianCpuMs(work: () => void): number {
        return [cpuMs(work), cpuMs(work), cpuMs(work)].sort((a, b) => a - b)[1];
    }

    /** How many reference passes the work costs on THIS machine, now. */
    function costInReferencePasses(label: string, work: () => void): number {
        const reference = medianCpuMs(() => {
            // Read the result so the pass cannot be optimised away.
            expect(runCatalogReferencePass(rows)).toBeGreaterThan(0);
        });
        const cost = medianCpuMs(work);
        // The measured numbers are the point: a green assertion alone tells
        // a reviewer nothing about how much headroom is left.
        console.log(
            `${label}: ${cost.toFixed(1)} ms, reference ${reference.toFixed(1)} ms, ratio ${(cost / reference).toFixed(2)}`
        );
        return cost / reference;
    }

    it(`indexes ${REAL_PLAYLIST_ROW_COUNT} rows within ${M3U_CATALOG_INDEX_BUDGET_RATIO} reference passes`, () => {
        let index = buildM3uCatalogIndex<SyntheticCatalogRow>([]);

        const ratio = costInReferencePasses(
            `catalog index (${rows.length} rows)`,
            () => {
                index = buildM3uCatalogIndex(rows);
            }
        );

        // Read the result so the build cannot be optimised away.
        expect(index.counts.live + index.counts.movie).toBeGreaterThan(0);
        expect(ratio).toBeLessThan(M3U_CATALOG_INDEX_BUDGET_RATIO);
    });

    it(`aggregates the series layer within ${M3U_SERIES_CATALOG_BUDGET_RATIO} reference passes`, () => {
        // The expensive half: title normalization runs per episode row, and
        // on a real catalog that is 40k of them. Kept a separate signal from
        // the index budget so a regression points at the right layer.
        const episodes = buildM3uCatalogIndex(rows).byKind.episode;
        let series = buildM3uSeriesCatalog<SyntheticCatalogRow>([], 'perf');

        const ratio = costInReferencePasses(
            `series catalog (${episodes.length} episodes)`,
            () => {
                series = buildM3uSeriesCatalog(episodes, 'perf');
            }
        );

        expect(series.length).toBeGreaterThan(0);
        expect(ratio).toBeLessThan(M3U_SERIES_CATALOG_BUDGET_RATIO);
    });

    it('produces the intended content mix', () => {
        // A generator that drifted into emitting one kind would make the
        // budget meaningless, so the fixture's own shape is asserted.
        const index = buildM3uCatalogIndex(rows);

        expect(index.counts.live / rows.length).toBeCloseTo(0.075, 2);
        expect(index.counts.movie / rows.length).toBeCloseTo(0.285, 2);
        expect(index.counts.episode / rows.length).toBeGreaterThan(0.6);
        expect(index.groupsByKind.episode.length).toBeGreaterThan(50);
    });
});

import {
    M3U_CATALOG_INDEX_BUDGET_MS,
    M3U_SERIES_CATALOG_BUDGET_MS,
    REAL_PLAYLIST_ROW_COUNT,
    createSyntheticCatalogRows,
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
 * is worse than no spec. The ceiling is still tight enough to fail on the
 * regressions that actually matter — an extra pass over the rows, a per-row
 * `new URL`, or a channel→kind map.
 */
describe('buildM3uCatalogIndex performance', () => {
    const rows = createSyntheticCatalogRows();

    it(`indexes ${REAL_PLAYLIST_ROW_COUNT} rows within ${M3U_CATALOG_INDEX_BUDGET_MS} ms`, () => {
        const samples: number[] = [];

        // Median of three: the first run pays for JIT warm-up on the
        // regexes, and a single sample would bake that into the budget.
        for (let run = 0; run < 3; run += 1) {
            const started = performance.now();
            const index = buildM3uCatalogIndex(rows);
            samples.push(performance.now() - started);

            // Read the result so the build cannot be optimised away.
            expect(index.counts.live + index.counts.movie).toBeGreaterThan(0);
        }

        const median = samples.sort((a, b) => a - b)[1];
        // The measured number is the point: a green assertion alone tells a
        // reviewer nothing about how much headroom is left.
        console.log(
            `catalog index: ${median.toFixed(1)} ms for ${rows.length} rows`
        );

        expect(median).toBeLessThan(M3U_CATALOG_INDEX_BUDGET_MS);
    });

    it(`aggregates the series layer within ${M3U_SERIES_CATALOG_BUDGET_MS} ms`, () => {
        // The expensive half: title normalization runs per episode row, and
        // on a real catalog that is 40k of them. Kept a separate signal from
        // the index budget so a regression points at the right layer.
        const episodes = buildM3uCatalogIndex(rows).byKind.episode;
        const samples: number[] = [];

        for (let run = 0; run < 3; run += 1) {
            const started = performance.now();
            const series = buildM3uSeriesCatalog(episodes, 'perf');
            samples.push(performance.now() - started);
            expect(series.length).toBeGreaterThan(0);
        }

        const median = samples.sort((a, b) => a - b)[1];
        console.log(
            `series catalog: ${median.toFixed(1)} ms for ${episodes.length} episodes`
        );

        expect(median).toBeLessThan(M3U_SERIES_CATALOG_BUDGET_MS);
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

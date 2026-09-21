/**
 * Synthetic playlist generator for the catalog-index budget spec.
 *
 * The mix is the one measured on the real playlist that motivated the
 * catalog work, because a generator that emits uniform rows measures the
 * wrong thing: the cost is dominated by which branch each row takes, and a
 * playlist of nothing but `/live/` rows never reaches the name regexes at
 * all.
 *
 *   7.5% live      `/live/….ts`
 *  28.5% movie     `/movie/….mkv`, names with a trailing year
 *  64.0% episode   `/series/….mp4`, names with `S1 E1`
 *
 * Roughly one episode row in forty is instead written as a Turkish daily
 * serial under `/movie/` (`5.BÖLÜM`), which is the shape that forces the
 * strong/weak marker check — the most expensive path in the classifier.
 */

/**
 * Budget for a full index build over `REAL_PLAYLIST_ROW_COUNT` rows.
 *
 * Local measurement is well under this; the ceiling is ~3x that, chosen to
 * survive a loaded CI runner while still failing on an algorithmic
 * regression — an extra pass over the rows, a per-row `new URL`, or a
 * channel→kind map being reintroduced.
 */
export const M3U_CATALOG_INDEX_BUDGET_MS = 300;

/**
 * Budget for collapsing the episode rows of that playlist into series.
 *
 * Higher than the index budget because title normalization runs per row and
 * is the dominant cost; measured at ~290 ms on a real 40k-episode catalog,
 * so this leaves headroom without hiding a regression.
 */
export const M3U_SERIES_CATALOG_BUDGET_MS = 900;

/** The size of the playlist the budget is expressed against. */
export const REAL_PLAYLIST_ROW_COUNT = 62_696;

const GROUP_COUNT = 111;
const TAGS = ['TR', 'DE', 'FR', 'NL', 'IT'];
const QUALITY = ['HD', 'FHD', 'UHD', 'SD', ''];

export interface SyntheticCatalogRow {
    readonly url: string;
    readonly name: string;
    readonly group: { readonly title: string };
}

/**
 * Deterministic: the same count always yields the same rows, so a budget
 * change is never explained away by a different fixture.
 */
export function createSyntheticCatalogRows(
    count: number = REAL_PLAYLIST_ROW_COUNT
): SyntheticCatalogRow[] {
    const rows: SyntheticCatalogRow[] = new Array(count);

    for (let index = 0; index < count; index += 1) {
        const tag = TAGS[index % TAGS.length];
        const group = { title: `Synthetic Group ${index % GROUP_COUNT}` };
        const bucket = index % 1000;

        if (bucket < 75) {
            rows[index] = {
                url: `http://provider.example/live/user/pass/${index}.ts`,
                name: `${tag}:Synthetic Channel ${index} ${
                    QUALITY[index % QUALITY.length]
                }`.trim(),
                group,
            };
            continue;
        }

        if (bucket < 360) {
            rows[index] = {
                url: `http://provider.example/movie/user/pass/${index}.mkv`,
                name: `${tag}:Synthetic Film ${index} - 20${10 + (index % 15)}`,
                group,
            };
            continue;
        }

        // One episode row in forty arrives as a daily serial under /movie/,
        // which is what exercises the strong/weak marker branch.
        if (bucket % 40 === 0) {
            rows[index] = {
                url: `http://provider.example/movie/user/pass/${index}.mp4`,
                name: `SYNTHETIC SERIAL ${index % 300} ${
                    (index % 120) + 1
                }.BÖLÜM`,
                group,
            };
            continue;
        }

        rows[index] = {
            url: `http://provider.example/series/user/pass/${index}.mp4`,
            name: `${tag}:SYNTHETIC SHOW ${index % 2000} S${
                (index % 8) + 1
            } E${(index % 24) + 1}`,
            group,
        };
    }

    return rows;
}

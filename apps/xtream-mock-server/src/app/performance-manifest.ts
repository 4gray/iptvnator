import { createHash } from 'node:crypto';
import { getPortalData } from './data-store.js';
import type { PerformanceManifest } from './performance-control.types.js';

const PERFORMANCE_USERNAME = 'performance';
const PERFORMANCE_PASSWORD = 'performance';

/**
 * The property insertion order is part of the fixture identity contract.
 * Never add credentials, server origins, or response envelopes to this input.
 */
export function buildPerformanceManifest(epoch: number): PerformanceManifest {
    const data = getPortalData(PERFORMANCE_USERNAME, PERFORMANCE_PASSWORD);
    const catalog = {
        liveCategories: data.liveCategories,
        vodCategories: data.vodCategories,
        seriesCategories: data.seriesCategories,
        liveCatalog: data.liveStreams,
        vodCatalog: data.vodStreams,
        seriesCatalog: data.seriesItems,
    };
    const serialized = JSON.stringify(catalog);
    const categoryCounts = {
        live: data.liveCategories.length,
        vod: data.vodCategories.length,
        series: data.seriesCategories.length,
    };
    const itemCounts = {
        live: data.liveStreams.length,
        vod: data.vodStreams.length,
        series: data.seriesItems.length,
    };

    return {
        epoch,
        scenario: 'performance-100k',
        seed: data.scenario.seed,
        counts: {
            categories: {
                ...categoryCounts,
                total:
                    categoryCounts.live +
                    categoryCounts.vod +
                    categoryCounts.series,
            },
            items: {
                ...itemCounts,
                total: itemCounts.live + itemCounts.vod + itemCounts.series,
            },
        },
        bytes: Buffer.byteLength(serialized, 'utf8'),
        catalogSha256: createHash('sha256')
            .update(serialized, 'utf8')
            .digest('hex'),
    };
}

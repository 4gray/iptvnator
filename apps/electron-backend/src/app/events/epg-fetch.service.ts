import { epgSourceGeneration, requestEpgSource } from './epg-source-generation';
import { eq } from 'drizzle-orm';
import { ElectronBridgeTrustOptions } from '@iptvnator/shared/interfaces';
import { getDatabase } from '../database/connection';
import * as schema from '../database/schema';
import { epgWorkerService } from './epg-worker.service';

/**
 * EPG freshness checks and multi-URL fetch orchestration.
 * Worker lifecycle itself lives in `epg-worker.service.ts`; this module only
 * decides *which* URLs are worth handing to it, and in what order.
 */

const loggerLabel = '[EPG Events]';

/** Age after which stored EPG data is refetched. */
export const EPG_FRESHNESS_MAX_AGE_HOURS = 12;

export interface EpgFreshnessResult {
    staleUrls: string[];
    freshUrls: string[];
}

export interface EpgFetchResult {
    success: boolean;
    message?: string;
    skipped?: string[];
}

/**
 * Check which EPG URLs have fresh data vs stale/missing data
 * @param urls - EPG source URLs to check
 * @param maxAgeHours - Maximum age in hours before data is considered stale
 */
export async function checkEpgFreshness(
    urls: string[],
    maxAgeHours: number
): Promise<EpgFreshnessResult> {
    const staleUrls: string[] = [];
    const freshUrls: string[] = [];
    const cutoffTime = new Date(
        Date.now() - maxAgeHours * 60 * 60 * 1000
    ).toISOString();

    try {
        const db = await getDatabase();

        for (const url of urls) {
            const generation = epgSourceGeneration(url);
            if (!url?.trim()) continue;

            const result = await db
                .select({ updatedAt: schema.epgChannelSources.updatedAt })
                .from(schema.epgChannelSources)
                .where(eq(schema.epgChannelSources.sourceUrl, url))
                .limit(1);

            const isFresh =
                result.length > 0 &&
                result[0].updatedAt &&
                result[0].updatedAt >= cutoffTime;

            if (generation !== epgSourceGeneration(url)) continue;
            if (isFresh) {
                freshUrls.push(url);
                epgWorkerService.markFetchedUrl(url);
            } else {
                staleUrls.push(url);
            }
        }
    } catch (error) {
        console.error(loggerLabel, 'Error checking EPG freshness:', error);
        return { staleUrls: urls, freshUrls: [] };
    }

    if (freshUrls.length > 0) {
        console.log(
            loggerLabel,
            `EPG fresh (skipping): ${freshUrls.length} source(s)`
        );
    }
    if (staleUrls.length > 0) {
        console.log(
            loggerLabel,
            `EPG stale (will fetch): ${staleUrls.length} source(s)`
        );
    }

    return { staleUrls, freshUrls };
}

/**
 * Handle EPG fetch from URLs
 * Automatically skips URLs with fresh data (less than 12 hours old)
 * Processes URLs sequentially to avoid SQLite database locking issues
 */
export async function handleFetchEpg(
    urls: string[],
    options: ElectronBridgeTrustOptions = {}
): Promise<EpgFetchResult> {
    const validUrls = urls
        .filter((url) => url?.trim())
        .map((url) => url.trim());
    const generations = new Map(
        validUrls.map((url) => [url, requestEpgSource(url)])
    );

    if (validUrls.length === 0) {
        return { success: false, message: 'No valid URLs provided' };
    }

    const { staleUrls, freshUrls } = await checkEpgFreshness(
        validUrls,
        EPG_FRESHNESS_MAX_AGE_HOURS
    );

    if (staleUrls.length === 0) {
        return {
            success: true,
            message: 'All EPG data is fresh',
            skipped: freshUrls,
        };
    }

    // Exclude URLs already processed this session — otherwise the loop sends
    // a 'queued' status, then fetchEpgFromUrl silently skips the URL and no
    // completion update ever arrives, leaving the UI stuck at "queued".
    const urlsToFetch = staleUrls.filter(
        (url) =>
            generations.get(url) === epgSourceGeneration(url) &&
            !epgWorkerService.hasFetchedUrl(url)
    );

    if (urlsToFetch.length === 0) {
        console.log(
            loggerLabel,
            `All ${staleUrls.length} stale URL(s) already fetched this session; skipping`
        );
        return { success: true, skipped: freshUrls };
    }

    urlsToFetch.forEach((url, index) => {
        epgWorkerService.sendProgressToRenderer(
            url,
            'queued',
            undefined,
            undefined,
            index + 1
        );
    });

    const errors: string[] = [];
    for (const url of urlsToFetch) {
        try {
            if (generations.get(url) !== epgSourceGeneration(url)) {
                epgWorkerService.sendProgressToRenderer(
                    url,
                    'cancelled',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    generations.get(url)
                );
                continue;
            }
            await epgWorkerService.fetchEpgFromUrl(url, options);
        } catch (error) {
            console.error(
                loggerLabel,
                `Error fetching EPG from ${url}:`,
                error
            );
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }

    if (errors.length > 0) {
        return {
            success: errors.length < urlsToFetch.length,
            message: errors.join('; '),
            skipped: freshUrls,
        };
    }

    return { success: true, skipped: freshUrls };
}

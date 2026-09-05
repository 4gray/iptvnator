import { eq } from 'drizzle-orm';
import { getDatabase } from '../database/connection';
import {
    appState,
    epgChannels,
    epgPrograms,
    playlists,
} from '../database/schema';
import { epgWorkerService } from './epg-worker.service';
import { requestedEpgSources, retireEpgSource } from './epg-source-generation';

let reconciliation = Promise.resolve();

/** Called only with settings successfully read from or written to IndexedDB. */
export function reconcileEpgSources(globalUrls: string[]): Promise<void> {
    const next = reconciliation
        .catch(() => undefined)
        .then(async () => {
            const db = await getDatabase();
            const migration = await db
                .select()
                .from(appState)
                .where(
                    eq(appState.key, 'm3u-playlists-indexeddb-to-sqlite-v1')
                );
            // A failed/incomplete migration cannot establish all playlist owners.
            if (migration[0]?.value !== '1') {
                throw new Error(
                    'EPG source reconciliation requires migrated playlists'
                );
            }
            const active = new Set(
                globalUrls.map((url) => url.trim()).filter(Boolean)
            );
            const savedPlaylists = await db
                .select({ type: playlists.type, urls: playlists.epgUrls })
                .from(playlists);
            for (const playlist of savedPlaylists) {
                if (!playlist.type.startsWith('m3u-')) continue;
                const urls: unknown = JSON.parse(playlist.urls || '[]');
                if (
                    !Array.isArray(urls) ||
                    urls.some((url) => typeof url !== 'string')
                ) {
                    throw new Error('Invalid saved playlist EPG ownership');
                }
                for (const url of urls as string[])
                    if (url.trim()) active.add(url.trim());
            }
            const channels = await db
                .selectDistinct({ url: epgChannels.sourceUrl })
                .from(epgChannels);
            const programs = await db
                .selectDistinct({ url: epgPrograms.sourceUrl })
                .from(epgPrograms);
            const removed = [
                ...new Set(
                    [
                        ...channels.map((row) => row.url),
                        ...programs.map((row) => row.url),
                        ...requestedEpgSources(),
                    ].filter(
                        (url): url is string =>
                            !!url?.trim() && !active.has(url.trim())
                    )
                ),
            ];
            // Fence the whole obsolete set before awaiting the first worker exit.
            removed.forEach(retireEpgSource);
            for (const url of removed)
                await epgWorkerService.clearEpgDataForSource(url);
        });
    reconciliation = next;
    return next;
}

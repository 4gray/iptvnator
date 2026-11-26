import { inject, Injectable, InjectionToken } from '@angular/core';
import type {
    Playlist,
    PlaylistRecentlyViewedItem,
    PlaylistRecentIdentity,
} from '@iptvnator/shared/interfaces';
import { SourceActivityService } from './lib/source-activity.service';
export type HistoryPlaylistAction =
    | { kind: 'touch'; item: PlaylistRecentlyViewedItem }
    | { kind: 'remove'; identities: PlaylistRecentIdentity[] }
    | { kind: 'clear' };
export interface HistoryPlaylistBridge {
    active(): boolean;
    project<T extends Playlist>(playlist: T): Promise<T>;
    mutate(
        playlist: Playlist,
        action: HistoryPlaylistAction
    ): Promise<Playlist | null>;
}
export const HISTORY_PLAYLIST_BRIDGE =
    new InjectionToken<HistoryPlaylistBridge>('History', {
        providedIn: 'root',
        factory: () => ({
            active: () => false,
            project: async (p) => p,
            mutate: async () => null,
        }),
    });

export function collectionConsentKey(
    instanceId: string | undefined,
    collection: 'favorites' | 'history'
): string | null {
    return instanceId
        ? `iptvnator-server:${instanceId}:${collection}-consent-v1`
        : null;
}

/** Fence queued work by profile, source epoch and the original sync consent. */
export function captureHistoryOwner(
    instanceId: string | undefined,
    sourceId: string | undefined,
    currentInstance: () => string | undefined,
    collection?: 'favorites' | 'history'
): () => boolean {
    const key =
        instanceId && sourceId
            ? `iptvnator-server:${instanceId}:history-source-epoch:${sourceId}`
            : null;
    const consentKey = collection
        ? collectionConsentKey(instanceId, collection)
        : null;
    try {
        const epoch = key ? localStorage.getItem(key) : null;
        const consent = consentKey ? localStorage.getItem(consentKey) : null;
        return () => {
            try {
                return (
                    currentInstance() === instanceId &&
                    (!key || localStorage.getItem(key) === epoch) &&
                    (!consentKey ||
                        localStorage.getItem(consentKey) === consent)
                );
            } catch {
                return false;
            }
        };
    } catch {
        return () => false;
    }
}

/** Order SQLite history mutations by source. A global clear overlaps every source. */
@Injectable({ providedIn: 'root' })
export class XtreamHistoryOrder {
    private readonly activity = inject(SourceActivityService);
    private readonly pending = new Set<{
        sources: readonly string[] | null;
        completed: Promise<unknown>;
    }>();

    run<T>(
        scope: string | readonly string[] | null,
        operation: () => Promise<T>,
        holdSources?: string | readonly string[]
    ): Promise<T> {
        const sources = typeof scope === 'string' ? [scope] : scope;
        const blockers = [...this.pending]
            .filter(
                (entry) =>
                    !sources ||
                    !entry.sources ||
                    entry.sources.some((id) => sources.includes(id))
            )
            .map((entry) => entry.completed.catch(() => undefined));
        const completed = Promise.all(blockers).then(
            holdSources
                ? () => this.activity.runWhenIdle(holdSources, operation)
                : operation
        );
        const entry = { sources, completed };
        this.pending.add(entry);
        const remove = () => this.pending.delete(entry);
        void completed.then(remove, remove);
        return completed;
    }
}

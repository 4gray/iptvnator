import { Injectable } from '@angular/core';
import type { TmdbMediaType } from '@iptvnator/shared/interfaces';
import { createBrowserUserDataStorage } from '../user-data-storage';

export interface TmdbMatchIdentity {
    provider: 'stalker' | 'xtream';
    playlistId: string;
    mediaType: TmdbMediaType;
    itemId: string;
    /** Stalker catalogs can reuse IDs; omitted values retain the VOD key. */
    catalog?: 'vod' | 'series';
}

export interface TmdbMatchContext {
    identity: TmdbMatchIdentity;
    title: string;
    tmdbId?: number | null;
}

export type TmdbMatchChoice =
    { mode: 'provider' } | { mode: 'manual'; tmdbId: number; title: string };

export function tmdbMatchKey(identity: TmdbMatchIdentity): string {
    return (
        'iptvnator:tmdb-match:v1:' +
        JSON.stringify([
            identity.provider,
            identity.playlistId,
            identity.mediaType,
            identity.itemId,
            ...(identity.provider === 'stalker' && identity.catalog === 'series'
                ? ['series']
                : []),
        ])
    );
}

/** Local, item-scoped choices, independent of disposable API caches. */
@Injectable({ providedIn: 'root' })
export class TmdbMatchService {
    private readonly storage = createBrowserUserDataStorage();
    private readonly versions = new Map<string, number>();
    // One current selection per owning store; replacing it releases its snapshot.
    private readonly selections = new Map<
        object,
        {
            key: string;
            refresh: () => Promise<void>;
        }
    >();

    read(identity: TmdbMatchIdentity): TmdbMatchChoice | null {
        try {
            const raw: unknown = JSON.parse(
                this.storage.getItem(tmdbMatchKey(identity)) ?? 'null'
            );
            if (!raw || typeof raw !== 'object' || !('mode' in raw))
                return null;
            if (raw.mode === 'provider') return { mode: 'provider' };
            if (
                raw.mode === 'manual' &&
                'tmdbId' in raw &&
                'title' in raw &&
                Number.isInteger(raw.tmdbId) &&
                Number(raw.tmdbId) > 0 &&
                typeof raw.title === 'string'
            ) {
                return {
                    mode: 'manual',
                    tmdbId: Number(raw.tmdbId),
                    title: raw.title,
                };
            }
        } catch {
            /* Unavailable or invalid storage leaves automatic matching usable. */
        }
        return null;
    }

    register(
        owner: object,
        identity: TmdbMatchIdentity,
        refresh: () => Promise<void>
    ): void {
        this.selections.set(owner, { key: tmdbMatchKey(identity), refresh });
    }

    version(identity: TmdbMatchIdentity): number {
        return this.versions.get(tmdbMatchKey(identity)) ?? 0;
    }

    async save(
        identity: TmdbMatchIdentity,
        choice: TmdbMatchChoice | null
    ): Promise<void> {
        const key = tmdbMatchKey(identity);
        // Commit before changing the screen; storage failures reach the dialog.
        if (choice) this.storage.setItem(key, JSON.stringify(choice));
        else this.storage.removeItem(key);
        this.versions.set(key, this.version(identity) + 1);
        await Promise.all(
            [...this.selections.values()]
                .filter((selection) => selection.key === key)
                .map((selection) => selection.refresh())
        );
    }
}

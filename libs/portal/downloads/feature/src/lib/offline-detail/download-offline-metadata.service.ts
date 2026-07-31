import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    DatabaseService,
    DownloadsService,
    PlaylistsService,
    SettingsStore,
    TMDB_DETAILS_CACHE_TTL_MS,
    TmdbEnrichmentService,
    type DownloadItem,
} from '@iptvnator/services';
import {
    createMovieDownloadSnapshot,
    createSeriesEpisodeDownloadSnapshot,
} from '@iptvnator/portal/shared/util';
import type {
    DownloadMetadataSnapshot,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import {
    mapProviderToDownloadSnapshot,
    mergeSnapshotWithTmdb,
    type DownloadMetadataProviderSource,
} from './download-metadata.mapper';
import type { DownloadOfflineDetail } from './download-offline-detail.viewmodel';

interface ProviderContext {
    source: DownloadMetadataProviderSource;
    provider?: unknown;
}

function representative(detail: DownloadOfflineDetail): DownloadItem {
    return (
        detail.kind === 'movie' ? detail.item : detail.representative
    ) as DownloadItem;
}

function targetId(detail: DownloadOfflineDetail): number {
    const item = representative(detail);
    return detail.kind === 'series'
        ? (item.seriesXtreamId ?? item.xtreamId)
        : item.xtreamId;
}

function normalizedPortalId(value: unknown): string {
    return String(value ?? '')
        .trim()
        .split(':')[0];
}

function matchingRecent(
    items: readonly StalkerPortalItem[],
    expectedId: number
): StalkerPortalItem | undefined {
    const expected = String(expectedId);
    return items.find((item) =>
        [item.id, item.movie_id, item.series_id, item.stream_id].some(
            (candidate) => normalizedPortalId(candidate) === expected
        )
    );
}

function episodeTitle(item: DownloadItem): string {
    const parts = item.title.split(/\s+-\s+S\d+E\d+\s+-\s+/i);
    return parts[parts.length - 1] ?? item.title;
}

function seriesTitle(item: DownloadItem): string {
    return item.title.replace(/\s+-\s+S\d+E\d+(?:\s+-\s+.*)?$/i, '').trim();
}

function fallbackSnapshot(
    detail: DownloadOfflineDetail,
    language: string
): DownloadMetadataSnapshot {
    const item = representative(detail);
    if (detail.kind === 'movie') {
        return createMovieDownloadSnapshot({
            language,
            title: item.title,
            posterUrl: item.posterUrl,
        });
    }

    const parent = {
        language,
        title: seriesTitle(item) || item.title,
        posterUrl: item.posterUrl,
    };
    const seasonNumber = item.seasonNumber;
    const episodeNumber = item.episodeNumber;
    if (
        !Number.isSafeInteger(seasonNumber) ||
        (seasonNumber ?? -1) < 0 ||
        !Number.isSafeInteger(episodeNumber) ||
        (episodeNumber ?? -1) < 0
    ) {
        return {
            ...createMovieDownloadSnapshot(parent),
            mediaKind: 'series',
        };
    }

    return createSeriesEpisodeDownloadSnapshot({
        ...parent,
        episode: {
            title: episodeTitle(item),
            seasonNumber: seasonNumber as number,
            episodeNumber: episodeNumber as number,
        },
    });
}

function existingSnapshot(
    detail: DownloadOfflineDetail
): DownloadMetadataSnapshot | undefined {
    const snapshot = detail.snapshot as DownloadMetadataSnapshot | undefined;
    const expectedKind = detail.kind === 'movie' ? 'movie' : 'series';
    return snapshot?.version === 1 && snapshot.mediaKind === expectedKind
        ? snapshot
        : undefined;
}

function isSparse(snapshot: DownloadMetadataSnapshot): boolean {
    return !snapshot.plot || (!snapshot.posterUrl && !snapshot.backdropUrl);
}

function isFresh(snapshot: DownloadMetadataSnapshot): boolean {
    const enrichedAt = Date.parse(snapshot.enrichedAt ?? '');
    const age = Date.now() - enrichedAt;
    return (
        Number.isFinite(enrichedAt) &&
        age >= 0 &&
        age <= TMDB_DETAILS_CACHE_TTL_MS
    );
}

function needsRefresh(
    snapshot: DownloadMetadataSnapshot | undefined,
    language: string
): boolean {
    return (
        !snapshot ||
        snapshot.language !== language ||
        isSparse(snapshot) ||
        !isFresh(snapshot)
    );
}

function materiallyEqual(
    left: DownloadMetadataSnapshot,
    right: DownloadMetadataSnapshot
): boolean {
    const leftFields = { ...left };
    const rightFields = { ...right };
    delete leftFields.enrichedAt;
    delete rightFields.enrichedAt;
    return (
        JSON.stringify(sortedValue(leftFields)) ===
        JSON.stringify(sortedValue(rightFields))
    );
}

function sortedValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortedValue);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
            result[key] = sortedValue((value as Record<string, unknown>)[key]);
            return result;
        }, {});
}

@Injectable({ providedIn: 'root' })
export class DownloadOfflineMetadataService {
    private readonly db = inject(DatabaseService);
    private readonly downloads = inject(DownloadsService);
    private readonly playlists = inject(PlaylistsService);
    private readonly settings = inject(SettingsStore);
    private readonly tmdb = inject(TmdbEnrichmentService);

    async resolve(
        detail: DownloadOfflineDetail
    ): Promise<DownloadMetadataSnapshot> {
        const language = this.currentLanguage();
        const persisted = existingSnapshot(detail);
        const local = persisted ?? fallbackSnapshot(detail, language);
        if (!needsRefresh(persisted, language)) {
            return local;
        }

        const context = await this.loadProviderContext(detail);
        let resolved = local;
        if (context.provider) {
            try {
                resolved = mapProviderToDownloadSnapshot({
                    source: context.source,
                    language,
                    mediaKind: local.mediaKind,
                    fallback: local,
                    provider: context.provider,
                });
            } catch {
                resolved = local;
            }
        }
        resolved = await this.enrichWithTmdb(
            resolved,
            context.source,
            language
        );

        if (materiallyEqual(local, resolved)) {
            return local;
        }

        try {
            await this.downloads.updateMetadata(
                representative(detail).id,
                resolved
            );
        } catch {
            // Enriched metadata remains useful for this view without backfill.
        }
        return resolved;
    }

    private currentLanguage(): string {
        try {
            return this.settings.language().trim() || 'en';
        } catch {
            return 'en';
        }
    }

    private async loadProviderContext(
        detail: DownloadOfflineDetail
    ): Promise<ProviderContext> {
        const item = representative(detail);
        let source: DownloadMetadataProviderSource;
        try {
            const playlist = await firstValueFrom(
                this.playlists.getPlaylistById(item.playlistId)
            );
            source =
                playlist?.portalUrl && playlist.macAddress
                    ? 'stalker'
                    : 'xtream';
        } catch {
            return { source: 'xtream' };
        }

        if (source === 'stalker') {
            try {
                const recent = await firstValueFrom(
                    this.playlists.getPortalRecentlyViewed(item.playlistId)
                );
                return {
                    source,
                    provider: matchingRecent(recent, targetId(detail)),
                };
            } catch {
                return { source };
            }
        }

        try {
            return {
                source,
                provider: await this.db.getContentByXtreamId(
                    targetId(detail),
                    item.playlistId
                ),
            };
        } catch {
            return { source: 'xtream' };
        }
    }

    private async enrichWithTmdb(
        snapshot: DownloadMetadataSnapshot,
        source: DownloadMetadataProviderSource,
        language: string
    ): Promise<DownloadMetadataSnapshot> {
        try {
            if (!this.tmdb.isEnabled()) {
                return snapshot;
            }
            const query = {
                title: snapshot.title,
                originalTitle: snapshot.originalTitle,
                year: snapshot.year,
                tmdbId: snapshot.tmdbId,
            };
            const details =
                snapshot.mediaKind === 'movie'
                    ? await this.tmdb.enrichMovie(query)
                    : await this.tmdb.enrichTv(query);
            return details
                ? mergeSnapshotWithTmdb(
                      snapshot.language === language
                          ? snapshot
                          : { ...snapshot, language },
                      details,
                      source
                  )
                : snapshot;
        } catch {
            return snapshot;
        }
    }
}

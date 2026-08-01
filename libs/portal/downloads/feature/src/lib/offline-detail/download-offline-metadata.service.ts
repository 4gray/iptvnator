import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    DatabaseService,
    DownloadsService,
    PlaylistsService,
    SettingsStore,
    TmdbEnrichmentService,
    type DownloadItem,
} from '@iptvnator/services';
import {
    createMovieDownloadSnapshot,
    createSeriesEpisodeDownloadSnapshot,
} from '@iptvnator/portal/shared/util';
import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';
import {
    mapProviderToDownloadSnapshot,
    mergeSnapshotWithTmdb,
    type DownloadMetadataProviderSource,
} from './download-metadata.mapper';
import {
    currentMetadataLanguage,
    finalizeMetadataRefresh,
    MetadataRefreshCoordinator,
    needsMetadataRefresh,
    TMDB_REFRESH_STATE,
    type TmdbRefreshResult,
    withoutMetadataFreshness,
} from './download-metadata-refresh';
import type { DownloadOfflineDetail } from './download-offline-detail.viewmodel';
import { findMatchingStalkerDownloadRecent } from '../stalker-download-recent.matcher';

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

function metadataWriteKey(detail: DownloadOfflineDetail): string {
    const item = representative(detail);
    if (
        detail.kind === 'series' &&
        Number.isSafeInteger(item.seriesXtreamId) &&
        (item.seriesXtreamId ?? 0) > 0
    ) {
        return `series:${item.playlistId}:${item.seriesXtreamId}`;
    }
    return `download:${item.id}`;
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
        return withoutMetadataFreshness(
            createMovieDownloadSnapshot({
                language,
                title: item.title,
                posterUrl: item.posterUrl,
            })
        );
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
        return withoutMetadataFreshness({
            ...createMovieDownloadSnapshot(parent),
            mediaKind: 'series',
        });
    }

    return withoutMetadataFreshness(
        createSeriesEpisodeDownloadSnapshot({
            ...parent,
            episode: {
                title: episodeTitle(item),
                seasonNumber: seasonNumber as number,
                episodeNumber: episodeNumber as number,
            },
        })
    );
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

@Injectable({ providedIn: 'root' })
export class DownloadOfflineMetadataService {
    private readonly db = inject(DatabaseService);
    private readonly downloads = inject(DownloadsService);
    private readonly playlists = inject(PlaylistsService);
    private readonly settings = inject(SettingsStore);
    private readonly tmdb = inject(TmdbEnrichmentService);
    private readonly refreshes = new MetadataRefreshCoordinator();

    async resolve(
        detail: DownloadOfflineDetail
    ): Promise<DownloadMetadataSnapshot> {
        const writeKey = metadataWriteKey(detail);
        const generation = this.refreshes.begin(writeKey);
        try {
            return await this.resolveGeneration(detail, writeKey, generation);
        } finally {
            this.refreshes.finish(writeKey, generation);
        }
    }

    private async resolveGeneration(
        detail: DownloadOfflineDetail,
        writeKey: string,
        generation: number
    ): Promise<DownloadMetadataSnapshot> {
        const language = currentMetadataLanguage(this.settings);
        const persisted = existingSnapshot(detail);
        const local = persisted ?? fallbackSnapshot(detail, language);
        const completedSparseAttempt = this.refreshes.isCompleted(
            writeKey,
            language
        );
        if (
            !needsMetadataRefresh(persisted, language, completedSparseAttempt)
        ) {
            return local;
        }

        const context = await this.loadProviderContext(detail);
        let resolved = local;
        let providerSucceeded = false;
        if (context.provider) {
            try {
                resolved = mapProviderToDownloadSnapshot({
                    source: context.source,
                    language,
                    mediaKind: local.mediaKind,
                    fallback: local,
                    provider: context.provider,
                });
                providerSucceeded = true;
            } catch {
                resolved = local;
            }
        }
        const tmdb = await this.enrichWithTmdb(
            resolved,
            context.source,
            language
        );
        const finalized = finalizeMetadataRefresh({
            language,
            local,
            providerSucceeded,
            snapshot: tmdb.snapshot,
            tmdbState: tmdb.state,
        });
        if (!finalized.shouldPersist) {
            return finalized.snapshot;
        }

        await this.refreshes.persistLatest({
            completedAttempt: finalized.completedAttempt,
            generation,
            groupKey: writeKey,
            language,
            persist: () =>
                this.downloads.updateMetadata(
                    representative(detail).id,
                    finalized.snapshot
                ),
        });
        return finalized.snapshot;
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
                    provider: findMatchingStalkerDownloadRecent(
                        recent,
                        targetId(detail),
                        item.contentType
                    ),
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
                    item.playlistId,
                    detail.kind === 'movie' ? 'movie' : 'series'
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
    ): Promise<TmdbRefreshResult> {
        try {
            if (!this.tmdb.isEnabled()) {
                return {
                    snapshot,
                    state: TMDB_REFRESH_STATE.DISABLED,
                };
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
            if (!details) {
                return { snapshot, state: TMDB_REFRESH_STATE.FAILED };
            }
            return {
                snapshot: mergeSnapshotWithTmdb(
                    snapshot.language === language
                        ? snapshot
                        : { ...snapshot, language },
                    details,
                    source
                ),
                state: TMDB_REFRESH_STATE.SUCCEEDED,
            };
        } catch {
            return { snapshot, state: TMDB_REFRESH_STATE.FAILED };
        }
    }
}

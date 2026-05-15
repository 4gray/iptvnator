import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { PlaylistsService } from './playlists.service';
import { SettingsStore } from './settings-store.service';
import { DatabaseService } from './database-electron.service';
import { PlaybackPositionService } from './playback-position.service';
import { XtreamPendingRestoreService } from './xtream-pending-restore.service';
import {
    isM3uRecentlyViewedItem,
    M3uPlaylistBackupEntry,
    M3uRecentlyViewedItem,
    Playlist,
    PlaylistBackupEntry,
    PlaylistBackupManifestV1,
    PlaylistBackupSettings,
    PLAYLIST_BACKUP_KIND,
    PLAYLIST_BACKUP_VERSION,
    StalkerPlaylistBackupEntry,
    StalkerPortalItem,
    XtreamBackupCategoryType,
    XtreamBackupContentType,
    XtreamPlaylistBackupEntry,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';

export interface PlaylistBackupExportPayload {
    defaultFileName: string;
    json: string;
    manifest: PlaylistBackupManifestV1;
}

export interface PlaylistBackupImportSummary {
    imported: number;
    merged: number;
    skipped: number;
    failed: number;
    errors: string[];
}

export class PlaylistBackupError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PlaylistBackupError';
    }
}

type PlaylistPortalType = 'm3u' | 'xtream' | 'stalker';

type XtreamContentType = XtreamBackupContentType;
type XtreamCategoryType = XtreamBackupCategoryType;

@Injectable({
    providedIn: 'root',
})
export class PlaylistBackupService {
    private readonly playlistsService = inject(PlaylistsService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly databaseService = inject(DatabaseService);
    private readonly playbackPositionService = inject(PlaybackPositionService);
    private readonly pendingRestoreService = inject(
        XtreamPendingRestoreService
    );

    async exportBackup(): Promise<PlaylistBackupExportPayload> {
        const playlists = await firstValueFrom(
            this.playlistsService.getAllData()
        );
        const settings = this.buildSettingsPayload();
        const playlistEntries = await Promise.all(
            playlists.map((playlist) => this.buildPlaylistEntry(playlist))
        );
        const exportedAt = new Date().toISOString();
        const manifest: PlaylistBackupManifestV1 = {
            kind: PLAYLIST_BACKUP_KIND,
            version: PLAYLIST_BACKUP_VERSION,
            exportedAt,
            includeSecrets: true,
            ...(settings ? { settings } : {}),
            playlists: playlistEntries,
        };

        return {
            defaultFileName: `iptvnator-playlist-backup-${exportedAt.slice(
                0,
                10
            )}.json`,
            json: JSON.stringify(manifest, null, 2),
            manifest,
        };
    }

    async importBackup(json: string): Promise<PlaylistBackupImportSummary> {
        const manifest = this.parseManifest(json);
        const existingPlaylists = await firstValueFrom(
            this.playlistsService.getAllData()
        );
        const existingIds = new Set(
            existingPlaylists.map((playlist) => playlist._id)
        );
        const fingerprintMap =
            await this.buildExistingFingerprintMap(existingPlaylists);
        const seenBackupFingerprints = new Set<string>();
        const summary: PlaylistBackupImportSummary = {
            imported: 0,
            merged: 0,
            skipped: 0,
            failed: 0,
            errors: [],
        };

        await this.restoreSettings(manifest.settings);

        for (const entry of manifest.playlists) {
            const entryLabel =
                entry.title || entry.exportedId || entry.portalType;

            try {
                const fingerprint = this.getEntryFingerprint(entry);

                if (seenBackupFingerprints.has(fingerprint)) {
                    summary.skipped += 1;
                    summary.errors.push(
                        `${entryLabel}: duplicate backup entry skipped`
                    );
                    continue;
                }

                seenBackupFingerprints.add(fingerprint);

                const existingMatch = fingerprintMap.get(fingerprint);
                const targetId = this.resolveTargetPlaylistId(
                    entry,
                    existingMatch?._id,
                    existingIds
                );
                const isMerge = existingMatch != null;
                const nextPlaylist = await this.buildImportedPlaylist(
                    entry,
                    targetId,
                    existingMatch ?? null
                );

                await firstValueFrom(
                    this.playlistsService.addPlaylist(nextPlaylist)
                );

                if (entry.portalType === 'xtream') {
                    await this.restoreXtreamEntry(targetId, entry);
                }

                if (isMerge) {
                    summary.merged += 1;
                } else {
                    summary.imported += 1;
                    existingIds.add(targetId);
                }
            } catch (error) {
                summary.failed += 1;
                summary.errors.push(
                    `${entryLabel}: ${this.getErrorMessage(error)}`
                );
            }
        }

        return summary;
    }

    private async buildPlaylistEntry(
        playlist: Playlist
    ): Promise<PlaylistBackupEntry> {
        const portalType = this.getPlaylistPortalType(playlist);

        switch (portalType) {
            case 'xtream':
                return this.buildXtreamEntry(playlist);
            case 'stalker':
                return this.buildStalkerEntry(playlist);
            case 'm3u':
            default:
                return this.buildM3uEntry(playlist);
        }
    }

    private async buildM3uEntry(
        playlist: Playlist
    ): Promise<M3uPlaylistBackupEntry> {
        const rawM3u = await firstValueFrom(
            this.playlistsService.getRawPlaylistById(playlist._id)
        );
        const favorites = Array.isArray(playlist.favorites)
            ? playlist.favorites.filter(
                  (item): item is string =>
                      typeof item === 'string' && item.trim().length > 0
              )
            : [];
        const recentlyViewed = Array.isArray(playlist.recentlyViewed)
            ? playlist.recentlyViewed.filter(isM3uRecentlyViewedItem)
            : [];

        return {
            portalType: 'm3u',
            exportedId: playlist._id,
            title: playlist.title,
            autoRefresh: Boolean(playlist.autoRefresh),
            position: playlist.position,
            source: {
                kind: this.resolveM3uSourceKind(playlist),
                rawM3u,
                ...(playlist.url ? { url: playlist.url } : {}),
                ...(playlist.userAgent
                    ? { userAgent: playlist.userAgent }
                    : {}),
                ...(playlist.referrer ? { referrer: playlist.referrer } : {}),
                ...(playlist.origin ? { origin: playlist.origin } : {}),
                ...(playlist.filePath
                    ? { filePathHint: playlist.filePath }
                    : {}),
            },
            userState: {
                favorites: this.uniqueStrings(favorites),
                recentlyViewed: recentlyViewed.map((item) => ({ ...item })),
                hiddenGroupTitles: this.uniqueStrings(
                    Array.isArray(playlist.hiddenGroupTitles)
                        ? playlist.hiddenGroupTitles
                        : []
                ),
            },
        };
    }

    private async buildXtreamEntry(
        playlist: Playlist
    ): Promise<XtreamPlaylistBackupEntry> {
        if (!this.hasElectronApi()) {
            return {
                portalType: 'xtream',
                exportedId: playlist._id,
                title: playlist.title,
                autoRefresh: Boolean(playlist.autoRefresh),
                position: playlist.position,
                connection: {
                    serverUrl: playlist.serverUrl ?? '',
                    username: playlist.username ?? '',
                    ...(playlist.password
                        ? { password: playlist.password }
                        : {}),
                },
                userState: {
                    hiddenCategories: [],
                    favorites: [],
                    recentlyViewed: [],
                    playbackPositions: [],
                },
            };
        }

        const [
            liveCategories,
            movieCategories,
            seriesCategories,
            favorites,
            recent,
            playbackPositions,
        ] = await Promise.all([
            this.databaseService.getAllXtreamCategories(playlist._id, 'live'),
            this.databaseService.getAllXtreamCategories(playlist._id, 'movies'),
            this.databaseService.getAllXtreamCategories(playlist._id, 'series'),
            this.databaseService.getFavorites(playlist._id),
            this.databaseService.getRecentItems(playlist._id),
            this.playbackPositionService.getAllPlaybackPositions(playlist._id),
        ]);

        return {
            portalType: 'xtream',
            exportedId: playlist._id,
            title: playlist.title,
            autoRefresh: Boolean(playlist.autoRefresh),
            position: playlist.position,
            connection: {
                serverUrl: playlist.serverUrl ?? '',
                username: playlist.username ?? '',
                ...(playlist.password ? { password: playlist.password } : {}),
            },
            userState: {
                hiddenCategories: [
                    ...this.mapHiddenCategories(liveCategories, 'live'),
                    ...this.mapHiddenCategories(movieCategories, 'movies'),
                    ...this.mapHiddenCategories(seriesCategories, 'series'),
                ],
                favorites: favorites.map((item) => ({
                    xtreamId: item.xtream_id,
                    contentType: item.type as XtreamContentType,
                    ...(item.added_at ? { addedAt: item.added_at } : {}),
                    ...(item.position !== undefined
                        ? { position: item.position }
                        : {}),
                })),
                recentlyViewed: recent.map((item) => ({
                    xtreamId: item.xtream_id,
                    contentType: item.type as XtreamContentType,
                    viewedAt: item.viewed_at ?? new Date().toISOString(),
                })),
                playbackPositions: playbackPositions.map((item) => ({
                    ...item,
                })),
            },
        };
    }

    private buildStalkerEntry(playlist: Playlist): StalkerPlaylistBackupEntry {
        return {
            portalType: 'stalker',
            exportedId: playlist._id,
            title: playlist.title,
            autoRefresh: Boolean(playlist.autoRefresh),
            position: playlist.position,
            connection: {
                portalUrl: playlist.portalUrl ?? playlist.url ?? '',
                macAddress: playlist.macAddress ?? '',
                ...(playlist.isFullStalkerPortal !== undefined
                    ? {
                          isFullStalkerPortal: playlist.isFullStalkerPortal,
                      }
                    : {}),
                ...(playlist.username ? { username: playlist.username } : {}),
                ...(playlist.password ? { password: playlist.password } : {}),
                ...(playlist.userAgent
                    ? { userAgent: playlist.userAgent }
                    : {}),
                ...(playlist.referrer ? { referrer: playlist.referrer } : {}),
                ...(playlist.origin ? { origin: playlist.origin } : {}),
                ...(playlist.stalkerSerialNumber
                    ? { stalkerSerialNumber: playlist.stalkerSerialNumber }
                    : {}),
                ...(playlist.stalkerDeviceId1
                    ? { stalkerDeviceId1: playlist.stalkerDeviceId1 }
                    : {}),
                ...(playlist.stalkerDeviceId2
                    ? { stalkerDeviceId2: playlist.stalkerDeviceId2 }
                    : {}),
                ...(playlist.stalkerSignature1
                    ? { stalkerSignature1: playlist.stalkerSignature1 }
                    : {}),
                ...(playlist.stalkerSignature2
                    ? { stalkerSignature2: playlist.stalkerSignature2 }
                    : {}),
            },
            userState: {
                favorites: this.extractStalkerItems(playlist.favorites),
                recentlyViewed: this.extractStalkerItems(
                    playlist.recentlyViewed
                ),
            },
        };
    }

    private buildSettingsPayload(): PlaylistBackupSettings | undefined {
        const epgUrls = this.normalizeSettingsUrls(
            this.settingsStore.getSettings().epgUrl ?? []
        );

        if (epgUrls.length === 0) {
            return undefined;
        }

        return { epgUrls };
    }

    private parseManifest(json: string): PlaylistBackupManifestV1 {
        let parsed: unknown;

        try {
            parsed = JSON.parse(json);
        } catch (error) {
            throw new PlaylistBackupError(
                `Invalid backup JSON: ${this.getErrorMessage(error)}`
            );
        }

        if (Array.isArray(parsed)) {
            throw new PlaylistBackupError(
                'Legacy playlist JSON exports are not supported. Create a versioned backup first.'
            );
        }

        if (!parsed || typeof parsed !== 'object') {
            throw new PlaylistBackupError('Backup file must be a JSON object.');
        }

        const manifest = parsed as Partial<PlaylistBackupManifestV1>;

        if (manifest.kind !== PLAYLIST_BACKUP_KIND) {
            throw new PlaylistBackupError('Unsupported backup file format.');
        }

        if (manifest.version !== PLAYLIST_BACKUP_VERSION) {
            throw new PlaylistBackupError(
                `Unsupported backup version: ${manifest.version ?? 'unknown'}`
            );
        }

        if (!Array.isArray(manifest.playlists)) {
            throw new PlaylistBackupError(
                'Backup file must contain playlists.'
            );
        }

        for (const entry of manifest.playlists) {
            this.validateEntry(entry);
        }

        return manifest as PlaylistBackupManifestV1;
    }

    private validateEntry(entry: PlaylistBackupEntry): void {
        if (!entry || typeof entry !== 'object') {
            throw new PlaylistBackupError(
                'Backup contains an invalid playlist entry.'
            );
        }

        if (!entry.exportedId || !entry.title) {
            throw new PlaylistBackupError(
                'Backup contains a playlist entry without required metadata.'
            );
        }

        switch (entry.portalType) {
            case 'm3u':
                if (!entry.source?.rawM3u) {
                    throw new PlaylistBackupError(
                        `M3U backup "${entry.title}" is missing raw playlist data.`
                    );
                }
                break;
            case 'xtream':
                if (
                    !entry.connection?.serverUrl ||
                    !entry.connection?.username
                ) {
                    throw new PlaylistBackupError(
                        `Xtream backup "${entry.title}" is missing connection metadata.`
                    );
                }
                break;
            case 'stalker':
                if (
                    !entry.connection?.portalUrl ||
                    !entry.connection?.macAddress
                ) {
                    throw new PlaylistBackupError(
                        `Stalker backup "${entry.title}" is missing connection metadata.`
                    );
                }
                break;
            default:
                throw new PlaylistBackupError(
                    `Unsupported backup playlist type: ${(entry as { portalType?: string }).portalType ?? 'unknown'}`
                );
        }
    }

    private async buildExistingFingerprintMap(
        playlists: Playlist[]
    ): Promise<Map<string, Playlist>> {
        const map = new Map<string, Playlist>();

        for (const playlist of playlists) {
            const portalType = this.getPlaylistPortalType(playlist);

            if (portalType === 'm3u' && !playlist.url) {
                const rawM3u = await firstValueFrom(
                    this.playlistsService.getRawPlaylistById(playlist._id)
                );
                map.set(this.buildM3uRawFingerprint(rawM3u), playlist);
                continue;
            }

            map.set(this.getPlaylistFingerprint(playlist), playlist);
        }

        return map;
    }

    private getPlaylistFingerprint(playlist: Playlist): string {
        const portalType = this.getPlaylistPortalType(playlist);

        switch (portalType) {
            case 'xtream':
                return [
                    'xtream',
                    this.normalizeUrlIdentity(playlist.serverUrl ?? ''),
                    this.normalizeIdentityValue(playlist.username ?? ''),
                ].join('|');
            case 'stalker':
                return [
                    'stalker',
                    this.normalizeUrlIdentity(
                        playlist.portalUrl ?? playlist.url ?? ''
                    ),
                    this.normalizeIdentityValue(
                        playlist.macAddress ?? '',
                        true
                    ),
                ].join('|');
            case 'm3u':
            default:
                if (playlist.url) {
                    return this.buildM3uUrlFingerprint(playlist.url);
                }

                throw new PlaylistBackupError(
                    `Unable to fingerprint M3U playlist "${playlist.title}".`
                );
        }
    }

    private getEntryFingerprint(entry: PlaylistBackupEntry): string {
        switch (entry.portalType) {
            case 'xtream':
                return [
                    'xtream',
                    this.normalizeUrlIdentity(entry.connection.serverUrl),
                    this.normalizeIdentityValue(entry.connection.username),
                ].join('|');
            case 'stalker':
                return [
                    'stalker',
                    this.normalizeUrlIdentity(entry.connection.portalUrl),
                    this.normalizeIdentityValue(
                        entry.connection.macAddress,
                        true
                    ),
                ].join('|');
            case 'm3u':
            default:
                if (entry.source.url) {
                    return this.buildM3uUrlFingerprint(entry.source.url);
                }

                return this.buildM3uRawFingerprint(entry.source.rawM3u);
        }
    }

    private buildM3uUrlFingerprint(url: string): string {
        return ['m3u', 'url', this.normalizeUrlIdentity(url)].join('|');
    }

    private buildM3uRawFingerprint(rawM3u: string): string {
        return [
            'm3u',
            'raw',
            this.hashString(this.canonicalizeM3u(rawM3u)),
        ].join('|');
    }

    private resolveTargetPlaylistId(
        entry: PlaylistBackupEntry,
        matchedId: string | undefined,
        existingIds: Set<string>
    ): string {
        if (matchedId) {
            return matchedId;
        }

        if (entry.exportedId && !existingIds.has(entry.exportedId)) {
            return entry.exportedId;
        }

        let nextId = uuidv4();

        while (existingIds.has(nextId)) {
            nextId = uuidv4();
        }

        return nextId;
    }

    private async buildImportedPlaylist(
        entry: PlaylistBackupEntry,
        playlistId: string,
        existing: Playlist | null
    ): Promise<Playlist> {
        switch (entry.portalType) {
            case 'xtream':
                return this.buildImportedXtreamPlaylist(
                    entry,
                    playlistId,
                    existing
                );
            case 'stalker':
                return this.buildImportedStalkerPlaylist(
                    entry,
                    playlistId,
                    existing
                );
            case 'm3u':
            default:
                return this.buildImportedM3uPlaylist(
                    entry,
                    playlistId,
                    existing
                );
        }
    }

    private async buildImportedM3uPlaylist(
        entry: M3uPlaylistBackupEntry,
        playlistId: string,
        existing: Playlist | null
    ): Promise<Playlist> {
        const parsedPlaylist = await this.playlistsService.handlePlaylistParsing(
            'TEXT',
            entry.source.rawM3u,
            entry.title
        );
        const now = new Date().toISOString();

        return {
            ...existing,
            ...parsedPlaylist,
            _id: playlistId,
            title: entry.title,
            filename: entry.title,
            importDate: existing?.importDate ?? now,
            lastUsage: existing?.lastUsage ?? now,
            autoRefresh: entry.autoRefresh,
            position: entry.position,
            favorites: this.uniqueStrings(entry.userState.favorites),
            recentlyViewed: entry.userState.recentlyViewed.map((item) =>
                this.normalizeM3uRecentlyViewedItem(item)
            ),
            hiddenGroupTitles: this.uniqueStrings(
                entry.userState.hiddenGroupTitles
            ),
            ...(entry.source.url
                ? { url: entry.source.url }
                : { url: undefined }),
            ...(entry.source.userAgent
                ? { userAgent: entry.source.userAgent }
                : { userAgent: undefined }),
            ...(entry.source.referrer
                ? { referrer: entry.source.referrer }
                : { referrer: undefined }),
            ...(entry.source.origin
                ? { origin: entry.source.origin }
                : { origin: undefined }),
            filePath: undefined,
        };
    }

    private buildImportedXtreamPlaylist(
        entry: XtreamPlaylistBackupEntry,
        playlistId: string,
        existing: Playlist | null
    ): Playlist {
        const now = new Date().toISOString();

        return {
            ...existing,
            _id: playlistId,
            title: entry.title,
            filename: entry.title,
            count: existing?.count ?? 0,
            importDate: existing?.importDate ?? now,
            lastUsage: existing?.lastUsage ?? now,
            autoRefresh: entry.autoRefresh,
            position: entry.position,
            serverUrl: entry.connection.serverUrl,
            username: entry.connection.username,
            password: entry.connection.password,
            favorites: [],
            recentlyViewed: [],
        };
    }

    private buildImportedStalkerPlaylist(
        entry: StalkerPlaylistBackupEntry,
        playlistId: string,
        existing: Playlist | null
    ): Playlist {
        const now = new Date().toISOString();

        return {
            ...existing,
            _id: playlistId,
            title: entry.title,
            filename: entry.title,
            count: existing?.count ?? 0,
            importDate: existing?.importDate ?? now,
            lastUsage: existing?.lastUsage ?? now,
            autoRefresh: entry.autoRefresh,
            position: entry.position,
            portalUrl: entry.connection.portalUrl,
            url: entry.connection.portalUrl,
            macAddress: entry.connection.macAddress,
            username: entry.connection.username,
            password: entry.connection.password,
            userAgent: entry.connection.userAgent,
            referrer: entry.connection.referrer,
            origin: entry.connection.origin,
            isFullStalkerPortal: entry.connection.isFullStalkerPortal,
            favorites: entry.userState.favorites.map((item) => ({ ...item })),
            recentlyViewed: entry.userState.recentlyViewed.map((item) => ({
                ...item,
            })),
            stalkerSerialNumber: entry.connection.stalkerSerialNumber,
            stalkerDeviceId1: entry.connection.stalkerDeviceId1,
            stalkerDeviceId2: entry.connection.stalkerDeviceId2,
            stalkerSignature1: entry.connection.stalkerSignature1,
            stalkerSignature2: entry.connection.stalkerSignature2,
            stalkerToken: undefined,
            stalkerAccountInfo: undefined,
        };
    }

    private async restoreSettings(
        settings: PlaylistBackupSettings | undefined
    ): Promise<void> {
        if (!settings?.epgUrls) {
            return;
        }

        const existingSettings = this.settingsStore.getSettings();
        const mergedEpgUrls = this.mergeUrls(
            settings.epgUrls,
            existingSettings.epgUrl ?? []
        );

        await this.settingsStore.updateSettings({
            epgUrl: mergedEpgUrls,
        });
    }

    private async restoreXtreamEntry(
        playlistId: string,
        entry: XtreamPlaylistBackupEntry
    ): Promise<void> {
        const restoreState: XtreamPendingRestoreState = {
            hiddenCategories: entry.userState.hiddenCategories.map((item) => ({
                ...item,
            })),
            favorites: entry.userState.favorites.map((item) => ({ ...item })),
            recentlyViewed: entry.userState.recentlyViewed.map((item) => ({
                ...item,
            })),
            playbackPositions: entry.userState.playbackPositions.map(
                (item) => ({
                    ...item,
                })
            ),
        };

        this.pendingRestoreService.set(playlistId, restoreState);

        if (!this.hasElectronApi()) {
            return;
        }

        if (!(await this.hasCompletedOfflineCache(playlistId))) {
            return;
        }

        await this.applyXtreamRestoreState(playlistId, restoreState);
        this.pendingRestoreService.clear(playlistId);
    }

    private async hasCompletedOfflineCache(
        playlistId: string
    ): Promise<boolean> {
        const checks = await Promise.all(
            [
                {
                    categoryType: 'live' as const,
                    contentType: 'live' as const,
                },
                {
                    categoryType: 'movies' as const,
                    contentType: 'movie' as const,
                },
                {
                    categoryType: 'series' as const,
                    contentType: 'series' as const,
                },
            ].map(async ({ categoryType, contentType }) => {
                const [importStatus, hasCategories, hasContent] =
                    await Promise.all([
                        this.databaseService.getXtreamImportStatus(
                            playlistId,
                            contentType
                        ),
                        this.databaseService.hasXtreamCategories(
                            playlistId,
                            categoryType
                        ),
                        this.databaseService.hasXtreamContent(
                            playlistId,
                            contentType
                        ),
                    ]);

                return (
                    importStatus === 'completed' && hasCategories && hasContent
                );
            })
        );

        return checks.every(Boolean);
    }

    private async applyXtreamRestoreState(
        playlistId: string,
        state: XtreamPendingRestoreState
    ): Promise<void> {
        await this.restoreXtreamCategoryVisibility(playlistId, state);
        await this.databaseService.restoreXtreamUserData(
            playlistId,
            state.favorites,
            state.recentlyViewed
        );

        await this.playbackPositionService.clearAllPlaybackPositions(
            playlistId
        );

        for (const playbackPosition of state.playbackPositions) {
            await this.playbackPositionService.savePlaybackPosition(
                playlistId,
                playbackPosition
            );
        }
    }

    private async restoreXtreamCategoryVisibility(
        playlistId: string,
        state: XtreamPendingRestoreState
    ): Promise<void> {
        const categoriesByType = await Promise.all([
            this.databaseService.getAllXtreamCategories(playlistId, 'live'),
            this.databaseService.getAllXtreamCategories(playlistId, 'movies'),
            this.databaseService.getAllXtreamCategories(playlistId, 'series'),
        ]);

        for (const categories of categoriesByType) {
            if (categories.length === 0) {
                continue;
            }

            await this.databaseService.updateCategoryVisibility(
                categories.map((category) => category.id),
                false
            );

            const hiddenCategoryIds = categories
                .filter((category) =>
                    state.hiddenCategories.some(
                        (hiddenCategory) =>
                            hiddenCategory.categoryType === category.type &&
                            hiddenCategory.xtreamId === category.xtream_id
                    )
                )
                .map((category) => category.id);

            if (hiddenCategoryIds.length > 0) {
                await this.databaseService.updateCategoryVisibility(
                    hiddenCategoryIds,
                    true
                );
            }
        }
    }

    private mapHiddenCategories(
        categories: Array<{
            hidden: boolean;
            xtream_id: number;
            type: XtreamCategoryType;
        }>,
        categoryType: XtreamCategoryType
    ): XtreamPendingRestoreState['hiddenCategories'] {
        return categories
            .filter((category) => category.hidden)
            .map((category) => ({
                categoryType,
                xtreamId: category.xtream_id,
            }));
    }

    private getPlaylistPortalType(playlist: Playlist): PlaylistPortalType {
        if (playlist.serverUrl && playlist.username) {
            return 'xtream';
        }

        if (playlist.macAddress && (playlist.portalUrl || playlist.url)) {
            return 'stalker';
        }

        return 'm3u';
    }

    private resolveM3uSourceKind(playlist: Playlist): 'url' | 'file' | 'text' {
        if (playlist.url) {
            return 'url';
        }

        if (playlist.filePath) {
            return 'file';
        }

        return 'text';
    }

    private extractStalkerItems(items: unknown): StalkerPortalItem[] {
        if (!Array.isArray(items)) {
            return [];
        }

        return items.filter(
            (item): item is StalkerPortalItem =>
                !!item && typeof item === 'object' && !Array.isArray(item)
        );
    }

    private normalizeM3uRecentlyViewedItem(
        item: M3uRecentlyViewedItem
    ): M3uRecentlyViewedItem {
        return {
            ...item,
            source: 'm3u',
            id: String(item.id ?? item.url),
            url: String(item.url),
            title: String(item.title ?? ''),
            category_id: 'live',
            added_at: item.added_at ?? new Date().toISOString(),
        };
    }

    private normalizeSettingsUrls(urls: string[]): string[] {
        return this.uniqueStrings(
            urls
                .map((url) => String(url ?? '').trim())
                .filter((url) => url.length > 0)
        );
    }

    private mergeUrls(primary: string[], secondary: string[]): string[] {
        const merged = new Map<string, string>();

        for (const url of [...primary, ...secondary]) {
            const normalized = this.normalizeUrlIdentity(url);

            if (!normalized || merged.has(normalized)) {
                continue;
            }

            merged.set(normalized, url.trim());
        }

        return [...merged.values()];
    }

    private uniqueStrings(values: string[]): string[] {
        const seen = new Set<string>();
        const result: string[] = [];

        for (const value of values) {
            const normalized = value.trim();

            if (!normalized || seen.has(normalized)) {
                continue;
            }

            seen.add(normalized);
            result.push(normalized);
        }

        return result;
    }

    private normalizeUrlIdentity(value: string): string {
        const trimmed = value.trim();

        if (!trimmed) {
            return '';
        }

        try {
            const url = new URL(trimmed);
            const pathname =
                url.pathname === '/'
                    ? '/'
                    : url.pathname.replace(/\/+$/, '') || '/';

            return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${pathname}${url.search}${url.hash}`;
        } catch {
            return trimmed.toLowerCase();
        }
    }

    private normalizeIdentityValue(value: string, toLowerCase = false): string {
        const trimmed = value.trim();
        return toLowerCase ? trimmed.toLowerCase() : trimmed;
    }

    private canonicalizeM3u(rawM3u: string): string {
        return rawM3u.replace(/\r\n?/g, '\n').trim();
    }

    private hashString(value: string): string {
        let hash = 0x811c9dc5;

        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }

        return (hash >>> 0).toString(16);
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private hasElectronApi(): boolean {
        return !!(window as Window & { electron?: unknown }).electron;
    }
}

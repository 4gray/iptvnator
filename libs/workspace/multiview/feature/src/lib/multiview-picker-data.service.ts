import { Injectable, inject } from '@angular/core';
import {
    type MultiviewCatalogSource,
    MultiviewCatalogService,
    StreamResolverService,
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import {
    collectionEpgKey,
    PORTAL_PLAYBACK_POSITIONS,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';
import {
    type EpgProgram,
    isCatalogUnavailable,
    type PlaybackPositionData,
} from '@iptvnator/shared/interfaces';
import { MultiviewOnScreenSources } from './multiview-on-screen';
import type { MultiviewEpgAllowance } from './multiview-picker-epg';
import {
    type MultiviewPickerRow,
    pickerSessionKey,
    toPickerRow,
} from './multiview-picker-row';
import {
    composePickerSections,
    type MultiviewContinueItem,
    type MultiviewPickerSection,
} from './multiview-picker-sections';

/** At most this many recent films are checked for a resume point. */
const CONTINUE_CANDIDATES = 20;
const WATCHED_RATIO = 0.95;

export interface MultiviewPickerData {
    readonly sections: readonly MultiviewPickerSection[];
    /** Groups of the current playlist, for the category menu (Q2). */
    readonly playlistGroups: readonly MultiviewCatalogSource[];
    /** The group of each current-playlist row, by its session key. */
    readonly playlistRowGroups: ReadonlyMap<string, string>;
    /**
     * The portal lists its channels per group only (a Stalker portal without
     * the full channel list): the category menu loads one group at a time.
     */
    readonly playlistPaged: boolean;
}

export function isResumable(position: PlaybackPositionData | null): boolean {
    if (!position || position.watched || position.positionSeconds <= 0) {
        return false;
    }
    const duration = position.durationSeconds ?? 0;
    return duration <= 0 || position.positionSeconds < duration * WATCHED_RATIO;
}

/**
 * Loads what the picker lists, from the sources the rest of the app already
 * uses (spec 9.5 table): favourites, recently viewed, saved film progress
 * and the current playlist's channels. A source that fails is just empty.
 */
@Injectable({ providedIn: 'root' })
export class MultiviewPickerDataService {
    private readonly favorites = inject(UnifiedFavoritesDataService);
    private readonly recent = inject(UnifiedRecentDataService);
    private readonly catalog = inject(MultiviewCatalogService);
    private readonly resolver = inject(StreamResolverService);
    private readonly positions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly locks = inject(ParentalLockService);
    private readonly onScreen = inject(MultiviewOnScreenSources);

    /**
     * R11 for listing: M3U and Stalker channels follow the parental lock as
     * their channel lists do; Xtream rows, films and series are listed as
     * the Favorites and Recent pages show them, and resolving them checks
     * the lock again.
     */
    isAllowed(item: UnifiedCollectionItem): boolean {
        // Xtream rows can carry a stored category id, which the catalog's
        // category check would misread; they are checked by stream id when
        // resolved (`MultiviewXtreamLock`).
        if (item.contentType === 'live' && item.sourceType !== 'xtream') {
            return this.catalog.isAllowed(item);
        }
        return !this.locks.withholdsEverything() && !isCatalogUnavailable(item);
    }

    async load(
        playlistId: string | null,
        signal: AbortSignal
    ): Promise<MultiviewPickerData> {
        const [favorites, recent, playlist] = await Promise.all([
            this.favorites.getFavorites('all').catch(() => []),
            this.recent.getRecentItems('all').catch(() => []),
            playlistId
                ? this.catalog.load(playlistId, signal).catch(() => null)
                : Promise.resolve(null),
        ]);
        const continueItems = await this.continueItems(recent);
        const tiles = this.onScreen.current();
        return {
            sections: composePickerSections({
                favorites,
                recent,
                continueItems,
                playlist: playlist?.channels.map((row) => row.item) ?? [],
                isAllowed: (item) => this.isAllowed(item),
                toRow: (item, position) =>
                    toPickerRow(item, tiles, { position }),
            }),
            playlistGroups: playlist?.groups ?? [],
            playlistRowGroups: new Map(
                (playlist?.channels ?? []).map((row) => [
                    pickerSessionKey(row.item),
                    row.group,
                ])
            ),
            playlistPaged:
                !!playlist &&
                playlist.channels.length === 0 &&
                playlist.groups.length > 0,
        };
    }

    /** One group of a paged portal, as rows (the category menu). */
    async loadPlaylistGroup(
        playlistId: string,
        groupId: string,
        signal: AbortSignal
    ): Promise<MultiviewPickerRow[]> {
        const channels = await this.catalog
            .loadGroup(playlistId, groupId, signal)
            .catch(() => []);
        const tiles = this.onScreen.current();
        return channels
            .map((row) => row.item)
            .filter((item) => item.radio !== 'true' && this.isAllowed(item))
            .map((item) => toPickerRow(item, tiles));
    }

    /** Current programmes of the visible rows, within the open's allowance. */
    async loadEpg(
        visible: readonly UnifiedCollectionItem[],
        allowance: MultiviewEpgAllowance
    ): Promise<ReadonlyMap<string, EpgProgram | null>> {
        const batch = allowance.take(visible);
        if (batch.length === 0) return new Map();
        return this.resolver.loadEpgForItems(batch).catch(() => new Map());
    }

    /** The programme a row shows, from a map {@link loadEpg} returned. */
    programFor(
        item: UnifiedCollectionItem,
        programs: ReadonlyMap<string, EpgProgram | null>
    ): EpgProgram | null {
        const key = collectionEpgKey(item);
        return key ? (programs.get(key) ?? null) : null;
    }

    /** Recently viewed Xtream films with a resume point, most recent first. */
    private async continueItems(
        recent: readonly UnifiedCollectionItem[]
    ): Promise<MultiviewContinueItem[]> {
        const films = recent
            .filter(
                (item) =>
                    item.contentType === 'movie' &&
                    item.sourceType === 'xtream' &&
                    item.xtreamId != null
            )
            .slice(0, CONTINUE_CANDIDATES);
        const positions = await Promise.all(
            films.map((item) =>
                this.positions.getPlaybackPosition(
                    item.playlistId,
                    item.xtreamId as number,
                    'vod'
                )
            )
        );
        const items: MultiviewContinueItem[] = [];
        films.forEach((item, index) => {
            const position = positions[index];
            if (position && isResumable(position))
                items.push({ item, position });
        });
        return items;
    }
}

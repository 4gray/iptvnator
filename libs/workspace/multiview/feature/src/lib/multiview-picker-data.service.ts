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
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { MultiviewSessionStore } from '@iptvnator/playback/multiview/data-access';
import {
    ParentalLockService,
    PlaybackPositionService,
} from '@iptvnator/services';
import {
    type EpgProgram,
    isCatalogUnavailable,
    type PlaybackPositionData,
} from '@iptvnator/shared/interfaces';
import type { MultiviewEpgAllowance } from './multiview-picker-epg';
import { toPickerRow } from './multiview-picker-row';
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
    private readonly positions = inject(PlaybackPositionService);
    private readonly locks = inject(ParentalLockService);
    private readonly store = inject(MultiviewSessionStore);

    /**
     * R11: a live channel follows the parental lock as the channel lists do;
     * films and series as the Favorites and Recent pages show them.
     */
    isAllowed(item: UnifiedCollectionItem): boolean {
        if (item.contentType === 'live') return this.catalog.isAllowed(item);
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
        const tiles = this.store.tiles();
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
        };
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

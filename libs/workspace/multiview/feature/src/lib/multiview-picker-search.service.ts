import { Injectable, inject } from '@angular/core';
import { sourceSortName } from '@iptvnator/playlist/shared/util';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    XTREAM_DATA_SOURCE,
    type XtreamContentItem,
} from '@iptvnator/portal/xtream/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { firstValueFrom } from 'rxjs';
import { MultiviewOnScreenSources } from './multiview-on-screen';
import { type MultiviewPickerRow, toPickerRow } from './multiview-picker-row';
import {
    EMPTY_PICKER_SEARCH,
    mergePickerSearch,
    type MultiviewPickerSearchResults,
    searchPickerRows,
} from './multiview-picker-search';

/** Search results kept per catalog type, like the playlist's own search. */
const CATALOG_RESULT_LIMIT = 50;

function toCollectionItem(
    row: XtreamContentItem,
    playlistId: string,
    playlistName: string
): UnifiedCollectionItem | null {
    const type = row.type === 'series' ? 'series' : 'movie';
    if (row.type !== 'movie' && row.type !== 'series') return null;
    return {
        uid: `xtream::${playlistId}::${type}:${row.xtream_id}`,
        name: row.title || row.name || '',
        contentType: type,
        sourceType: 'xtream',
        playlistId,
        playlistName,
        posterUrl: row.poster_url || null,
        xtreamId: row.xtream_id,
        contentId: row.id,
        // Detail navigation (the survivor's way back) needs the category.
        categoryId: row.category_id,
    };
}

/**
 * Picker search (spec 9.5). Rows the picker already loaded are filtered on
 * the client in every runtime; an Xtream current playlist also searches its
 * films and series through its data source — SQLite in Electron, the
 * cached catalog in the PWA — chosen by the data source provider, which
 * applies hidden categories and the parental lock itself.
 */
@Injectable({ providedIn: 'root' })
export class MultiviewPickerSearchService {
    private readonly xtream = inject(XTREAM_DATA_SOURCE);
    private readonly playlists = inject(PlaylistsService);
    private readonly onScreen = inject(MultiviewOnScreenSources);

    async search(
        term: string,
        loaded: readonly MultiviewPickerRow[],
        playlistId: string | null
    ): Promise<MultiviewPickerSearchResults> {
        const local = searchPickerRows(loaded, term);
        if (local === EMPTY_PICKER_SEARCH || !playlistId) return local;
        const catalog = await this.searchXtreamCatalog(term, playlistId);
        return mergePickerSearch(local, searchPickerRows(catalog, term));
    }

    private async searchXtreamCatalog(
        term: string,
        playlistId: string
    ): Promise<MultiviewPickerRow[]> {
        try {
            const playlist = await firstValueFrom(
                this.playlists.getPlaylistById(playlistId)
            );
            if (!playlist?.serverUrl || playlist.macAddress) return [];
            const rows = await this.xtream.searchContent(
                playlistId,
                term.trim(),
                ['movie', 'series'],
                true
            );
            const name = sourceSortName(playlist);
            const tiles = this.onScreen.current();
            return rows
                .slice(0, CATALOG_RESULT_LIMIT * 2)
                .map((row) => toCollectionItem(row, playlistId, name))
                .filter((item): item is UnifiedCollectionItem => !!item)
                .map((item) => toPickerRow(item, tiles));
        } catch {
            return [];
        }
    }
}

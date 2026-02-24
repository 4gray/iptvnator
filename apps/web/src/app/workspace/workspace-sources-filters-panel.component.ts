import { computed, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { Store } from '@ngrx/store';
import {
    FilterActions,
    selectActiveTypeFilters,
    selectAllPlaylistsMeta,
} from 'm3u-state';
import { TranslatePipe } from '@ngx-translate/core';
import { SortBy, SortOrder, SortService } from 'services';

type PlaylistFilterId = 'all' | 'm3u' | 'xtream' | 'stalker';

interface PlaylistFilterOption {
    id: PlaylistFilterId;
    icon: string;
    label: string;
    translationKey?: string;
}

interface SortOption {
    by: SortBy;
    order: SortOrder;
    icon: string;
    translationKey: string;
}

const ALL_FILTERS = ['m3u', 'xtream', 'stalker'];

@Component({
    selector: 'app-workspace-sources-filters-panel',
    imports: [MatIcon, MatListModule, TranslatePipe],
    templateUrl: './workspace-sources-filters-panel.component.html',
    styleUrl: './workspace-sources-filters-panel.component.scss',
})
export class WorkspaceSourcesFiltersPanelComponent {
    private readonly store = inject(Store);
    private readonly sortService = inject(SortService);

    private readonly activeTypeFilters = this.store.selectSignal(
        selectActiveTypeFilters
    );
    private readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);

    readonly currentSortOptions = toSignal(this.sortService.getSortOptions(), {
        requireSync: true,
    });

    readonly typeOptions: PlaylistFilterOption[] = [
        {
            id: 'all',
            icon: 'layers',
            label: 'All',
        },
        {
            id: 'm3u',
            icon: 'playlist_play',
            translationKey: 'HOME.PLAYLIST_TYPES.M3U',
            label: 'M3U',
        },
        {
            id: 'xtream',
            icon: 'cloud',
            translationKey: 'HOME.PLAYLIST_TYPES.XTREAM',
            label: 'Xtream',
        },
        {
            id: 'stalker',
            icon: 'router',
            translationKey: 'HOME.PLAYLIST_TYPES.STALKER',
            label: 'Stalker',
        },
    ];

    readonly sortOptions: SortOption[] = [
        {
            by: SortBy.DATE_ADDED,
            order: SortOrder.DESC,
            icon: 'schedule',
            translationKey: 'HOME.SORT_OPTIONS.NEWEST',
        },
        {
            by: SortBy.DATE_ADDED,
            order: SortOrder.ASC,
            icon: 'history',
            translationKey: 'HOME.SORT_OPTIONS.OLDEST',
        },
        {
            by: SortBy.NAME,
            order: SortOrder.ASC,
            icon: 'sort_by_alpha',
            translationKey: 'HOME.SORT_OPTIONS.NAME_ASC',
        },
        {
            by: SortBy.NAME,
            order: SortOrder.DESC,
            icon: 'sort_by_alpha',
            translationKey: 'HOME.SORT_OPTIONS.NAME_DESC',
        },
        {
            by: SortBy.CUSTOM,
            order: SortOrder.ASC,
            icon: 'drag_indicator',
            translationKey: 'HOME.SORT_OPTIONS.CUSTOM_ORDER',
        },
    ];

    readonly typeCounts = computed(() => {
        const items = this.playlists();
        return {
            all: items.length,
            m3u: items.filter((item) => !item.serverUrl && !item.macAddress)
                .length,
            xtream: items.filter((item) => !!item.serverUrl).length,
            stalker: items.filter((item) => !!item.macAddress).length,
        };
    });

    isTypeActive(filterId: PlaylistFilterId): boolean {
        const selected = this.activeTypeFilters();
        if (filterId === 'all') {
            return (
                selected.length === ALL_FILTERS.length &&
                ALL_FILTERS.every((id) => selected.includes(id))
            );
        }

        return selected.length === 1 && selected[0] === filterId;
    }

    selectType(filterId: PlaylistFilterId): void {
        const selectedFilters =
            filterId === 'all' ? ALL_FILTERS : [filterId];
        this.store.dispatch(
            FilterActions.setSelectedFilters({
                selectedFilters,
            })
        );
    }

    getTypeCount(filterId: PlaylistFilterId): number {
        const counts = this.typeCounts();
        if (filterId === 'all') {
            return counts.all;
        }
        return counts[filterId];
    }

    isSortActive(option: SortOption): boolean {
        const current = this.currentSortOptions();
        return current.by === option.by && current.order === option.order;
    }

    setSortOption(option: SortOption): void {
        this.sortService.setSortOptions({
            by: option.by,
            order: option.order,
        });
    }
}

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { Store } from '@ngrx/store';
import {
    FilterActions,
    selectActiveTypeFilters,
    selectAllPlaylistsMeta,
} from '@iptvnator/m3u-state';
import { TranslatePipe } from '@ngx-translate/core';
import { WorkspaceShellContextDrawerService } from '../workspace-shell/services/workspace-shell-context-drawer.service';

type PlaylistFilterId = 'all' | 'm3u' | 'xtream' | 'stalker';

interface PlaylistFilterOption {
    id: PlaylistFilterId;
    icon: string;
    label?: string;
    translationKey?: string;
}

const ALL_FILTERS = ['m3u', 'xtream', 'stalker'];

@Component({
    selector: 'app-workspace-sources-filters-panel',
    imports: [MatIcon, MatListModule, TranslatePipe],
    templateUrl: './workspace-sources-filters-panel.component.html',
    styleUrl: './workspace-sources-filters-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceSourcesFiltersPanelComponent {
    private readonly store = inject(Store);
    // Optional: only provided inside the workspace shell; picking a type
    // filter is a single-select choice that never navigates, so the phone
    // drawer closes here to reveal the filtered list.
    private readonly contextDrawer = inject(WorkspaceShellContextDrawerService, {
        optional: true,
    });

    private readonly activeTypeFilters = this.store.selectSignal(
        selectActiveTypeFilters
    );
    private readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);

    readonly typeOptions: PlaylistFilterOption[] = [
        {
            id: 'all',
            icon: 'layers',
            translationKey: 'WORKSPACE.SOURCES.ALL',
        },
        {
            id: 'm3u',
            icon: 'playlist_play',
            translationKey: 'HOME.PLAYLIST_TYPES.M3U',
        },
        {
            id: 'xtream',
            icon: 'cloud',
            translationKey: 'HOME.PLAYLIST_TYPES.XTREAM',
        },
        {
            id: 'stalker',
            icon: 'router',
            translationKey: 'HOME.PLAYLIST_TYPES.STALKER',
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
        this.contextDrawer?.close();
    }

    getTypeCount(filterId: PlaylistFilterId): number {
        const counts = this.typeCounts();
        if (filterId === 'all') {
            return counts.all;
        }
        return counts[filterId];
    }
}

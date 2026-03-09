import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { PlaylistType, RecentPlaylistsComponent } from 'components';
import { selectActiveTypeFilters, selectAllPlaylistsMeta } from 'm3u-state';
import { map } from 'rxjs';
import { WORKSPACE_SHELL_ACTIONS } from '../workspace-shell/workspace-shell-actions';

@Component({
    selector: 'app-workspace-sources',
    imports: [RecentPlaylistsComponent],
    templateUrl: './workspace-sources.component.html',
    styleUrl: './workspace-sources.component.scss',
})
export class WorkspaceSourcesComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly store = inject(Store);
    private readonly workspaceActions = inject(WORKSPACE_SHELL_ACTIONS);

    private readonly activeTypeFilters = this.store.selectSignal(
        selectActiveTypeFilters
    );
    private readonly playlists = this.store.selectSignal(
        selectAllPlaylistsMeta
    );

    readonly searchQuery = toSignal(
        this.route.queryParamMap.pipe(map((params) => params.get('q') ?? '')),
        { initialValue: '' }
    );
    readonly title = computed(() => {
        const filters = this.activeTypeFilters();

        if (filters.length === 1) {
            if (filters[0] === 'm3u') {
                return 'M3U Playlists';
            }
            if (filters[0] === 'xtream') {
                return 'Xtream Playlists';
            }
            if (filters[0] === 'stalker') {
                return 'Stalker Playlists';
            }
        }

        return 'All Playlists';
    });

    readonly visibleSourcesCount = computed(() => {
        const query = this.searchQuery().trim().toLowerCase();
        const filters = this.activeTypeFilters();
        const allPlaylists = this.playlists();

        return allPlaylists
            .filter((item) => {
                const isStalkerFilter =
                    !!item.macAddress && filters.includes('stalker');
                const isXtreamFilter =
                    !!item.username &&
                    !!item.password &&
                    !!item.serverUrl &&
                    filters.includes('xtream');
                const isM3uFilter =
                    !item.username &&
                    !item.password &&
                    !item.serverUrl &&
                    !item.macAddress &&
                    filters.includes('m3u');

                return isStalkerFilter || isXtreamFilter || isM3uFilter;
            })
            .filter((item) => (item.title || '').toLowerCase().includes(query))
            .length;
    });

    readonly subtitle = computed(() => {
        const count = this.visibleSourcesCount();
        return `${count} ${count === 1 ? 'playlist' : 'playlists'}`;
    });

    onAddPlaylist(playlistType: PlaylistType): void {
        this.workspaceActions.openAddPlaylistDialog(playlistType);
    }
}

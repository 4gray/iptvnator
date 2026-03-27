import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import {
    PlaylistType,
    RecentPlaylistsComponent,
} from '../../../../../../playlist/shared/ui/src';
import { TranslateService } from '@ngx-translate/core';
import {
    selectActiveTypeFilters,
    selectAllPlaylistsMeta,
} from '../../../../../../m3u-state/src/lib/selectors';
import { map, startWith } from 'rxjs';
import { WORKSPACE_SHELL_ACTIONS } from '../../../../util/src';

@Component({
    selector: 'app-workspace-sources',
    imports: [RecentPlaylistsComponent],
    templateUrl: './workspace-sources.component.html',
    styleUrls: ['./workspace-sources.component.scss'],
})
export class WorkspaceSourcesComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly store = inject(Store);
    private readonly workspaceActions = inject(WORKSPACE_SHELL_ACTIONS);
    private readonly translate = inject(TranslateService);

    private readonly activeTypeFilters = this.store.selectSignal(
        selectActiveTypeFilters
    );

    private readonly playlists = this.store.selectSignal(
        selectAllPlaylistsMeta
    );

    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly searchQuery = toSignal(
        this.route.queryParamMap.pipe(map((params) => params.get('q') ?? '')),
        { initialValue: '' }
    );

    readonly title = computed(() => {
        this.languageTick();

        const filters = this.activeTypeFilters() as string[];

        if (filters.length === 1) {
            if (filters[0] === 'm3u') {
                return this.translateText('WORKSPACE.SOURCES.M3U_PLAYLISTS');
            }

            if (filters[0] === 'xtream') {
                return this.translateText('WORKSPACE.SOURCES.XTREAM_PLAYLISTS');
            }

            if (filters[0] === 'stalker') {
                return this.translateText(
                    'WORKSPACE.SOURCES.STALKER_PLAYLISTS'
                );
            }
        }

        return this.translateText('WORKSPACE.SOURCES.ALL_PLAYLISTS');
    });

    readonly visibleSourcesCount = computed(() => {
        const query = this.searchQuery().trim().toLowerCase();
        const filters = this.activeTypeFilters() as string[];
        const allPlaylists = this.playlists() as Array<{
            title?: string;
            username?: string;
            password?: string;
            serverUrl?: string;
            macAddress?: string;
            isCustomPortal?: boolean;
        }>;

        return allPlaylists
            .filter((item) => {
                const isCustomPortalStalker = item.isCustomPortal === true;

                const isStalkerFilter =
                    (Boolean(item.macAddress) || isCustomPortalStalker) &&
                    filters.includes('stalker');

                const isXtreamFilter =
                    !isCustomPortalStalker &&
                    Boolean(item.username) &&
                    Boolean(item.password) &&
                    Boolean(item.serverUrl) &&
                    filters.includes('xtream');

                const isM3uFilter =
                    !isCustomPortalStalker &&
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
        this.languageTick();

        const count = this.visibleSourcesCount();

        if (count === 1) {
            return this.translateText('WORKSPACE.SOURCES.PLAYLIST_COUNT_ONE');
        }

        return this.translateText('WORKSPACE.SOURCES.PLAYLIST_COUNT_OTHER', {
            count,
        });
    });

    onAddPlaylist(playlistType: PlaylistType): void {
        this.workspaceActions.openAddPlaylistDialog(playlistType);
    }

    private translateText(
        key: string,
        params?: Record<string, string | number>
    ): string {
        return this.translate.instant(key, params);
    }
}
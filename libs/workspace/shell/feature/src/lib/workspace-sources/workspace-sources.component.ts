import { WorkspaceShellXtreamImportService } from '../workspace-shell/services/workspace-shell-xtream-import.service';
import { Injector, viewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
    SourceCleanupDialogComponent,
    PlaylistRefreshActionService,
} from '@iptvnator/playlist/shared/ui';
import {
    RuntimeCapabilitiesService,
    SourceActivityService,
} from '@iptvnator/services';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    isLiveExternalPlayerSession,
} from '@iptvnator/portal/shared/util';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    sourceHealthType,
    PlaylistUpdateState,
} from '@iptvnator/shared/interfaces';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { RecentPlaylistsComponent } from '@iptvnator/playlist/shared/ui';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    selectActiveTypeFilters,
    selectAllPlaylistsMeta,
} from '@iptvnator/m3u-state';
import { map, startWith } from 'rxjs';
import { SortBy, SortOrder, SortService } from '@iptvnator/services';
import {
    WORKSPACE_SHELL_ACTIONS,
    WorkspacePlaylistType,
} from '@iptvnator/workspace/shell/util';

interface SortOption {
    by: SortBy;
    order: SortOrder;
    icon: string;
    translationKey: string;
}

@Component({
    selector: 'app-workspace-sources',
    imports: [
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        RecentPlaylistsComponent,
        TranslatePipe,
    ],
    templateUrl: './workspace-sources.component.html',
    styleUrl: './workspace-sources.component.scss',
})
export class WorkspaceSourcesComponent {
    private readonly injector = inject(Injector);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly playback = inject(PORTAL_EXTERNAL_PLAYBACK, {
        optional: true,
    });
    private readonly imports = inject(WorkspaceShellXtreamImportService, {
        optional: true,
    });
    private readonly sourceList = viewChild(RecentPlaylistsComponent);
    readonly canCleanSources = computed(
        () =>
            this.runtime.supportsSourceHealth &&
            this.playlists().some((p) => sourceHealthType(p))
    );
    openCleanup(): void {
        const dialogs = this.injector.get(MatDialog);
        const refresh = this.injector.get(PlaylistRefreshActionService);
        const activity = this.injector.get(SourceActivityService);
        if (dialogs.getDialogById('source-cleanup')) return;
        dialogs.open(SourceCleanupDialogComponent, {
            id: 'source-cleanup',
            width: '680px',
            maxWidth: '95vw',
            data: {
                playlists: this.playlists(),
                current: (id: string) =>
                    this.playlists().find((p) => p._id === id),
                protected: (id: string) =>
                    (isLiveExternalPlayerSession(
                        this.playback?.activeSession()
                    ) &&
                        this.playback?.activeSession()?.contentInfo
                            ?.playlistId === id) ||
                    activity.isBusy(id) ||
                    refresh.isSourceBusy(id) ||
                    !!this.imports?.isSourceBusy(id) ||
                    !!this.sourceList()?.isDeletePending(id) ||
                    !!this.sourceList()?.isRefreshPending(id) ||
                    this.playlists().find((p) => p._id === id)?.updateState ===
                        PlaylistUpdateState.IN_PROGRESS,
                removed: (id: string) =>
                    this.store.dispatch(
                        PlaylistActions.playlistRemovalCommitted({
                            playlistId: id,
                        })
                    ),
            },
        });
    }
    private readonly route = inject(ActivatedRoute);
    private readonly store = inject(Store);
    private readonly workspaceActions = inject(WORKSPACE_SHELL_ACTIONS);
    private readonly translate = inject(TranslateService);
    private readonly sortService = inject(SortService);

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

    private readonly currentSortOptions = toSignal(
        this.sortService.getSortOptions(),
        { requireSync: true }
    );

    readonly searchQuery = toSignal(
        this.route.queryParamMap.pipe(map((params) => params.get('q') ?? '')),
        { initialValue: '' }
    );
    readonly title = computed(() => {
        this.languageTick();

        const filters = this.activeTypeFilters();

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
        this.languageTick();

        const count = this.visibleSourcesCount();
        if (count === 1) {
            return this.translateText('WORKSPACE.SOURCES.PLAYLIST_COUNT_ONE');
        }

        return this.translateText('WORKSPACE.SOURCES.PLAYLIST_COUNT_OTHER', {
            count,
        });
    });

    readonly activeSortLabel = computed(() => {
        this.languageTick();
        const current = this.currentSortOptions();
        const match = this.sortOptions.find(
            (option) =>
                option.by === current.by && option.order === current.order
        );
        return this.translateText(
            match?.translationKey ?? 'HOME.SORT_OPTIONS.NEWEST'
        );
    });

    onAddPlaylist(type?: WorkspacePlaylistType): void {
        this.workspaceActions.openAddPlaylistDialog(type);
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

    private translateText(
        key: string,
        params?: Record<string, string | number>
    ): string {
        return this.translate.instant(key, params);
    }
}

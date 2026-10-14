import { WorkspaceShellXtreamImportService } from '../workspace-shell/services/workspace-shell-xtream-import.service';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    Injector,
    viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import {
    SourceStatusService,
    sourceStatusBucket,
} from '@iptvnator/portal/shared/data-access';
import {
    isLiveExternalPlayerSession,
    PORTAL_EXTERNAL_PLAYBACK,
} from '@iptvnator/portal/shared/util';
import {
    PlaylistRefreshActionService,
    RecentPlaylistsComponent,
    SourceCleanupDialogComponent,
    SourceRemovalService,
} from '@iptvnator/playlist/shared/ui';
import {
    filterSources,
    SourceBucketOf,
    SourcesViewStateService,
} from '@iptvnator/playlist/shared/util';
import {
    injectTranslationTick,
    RuntimeCapabilitiesService,
    SortService,
    SourceActivityService,
} from '@iptvnator/services';
import {
    PlaylistUpdateState,
    sourceHealthType,
} from '@iptvnator/shared/interfaces';
import {
    MenuItemRadioCheckDirective,
    MenuItemRadioDirective,
} from '@iptvnator/ui/components';
import {
    WORKSPACE_SHELL_ACTIONS,
    WorkspacePlaylistType,
} from '@iptvnator/workspace/shell/util';
import {
    isSortOptionActive,
    SOURCE_SORT_OPTIONS,
    SourceSortOption,
} from './workspace-sources-sort-options';

const TYPE_TITLE_KEYS = {
    all: 'WORKSPACE.SOURCES.ALL_PLAYLISTS',
    m3u: 'WORKSPACE.SOURCES.M3U_PLAYLISTS',
    xtream: 'WORKSPACE.SOURCES.XTREAM_PLAYLISTS',
    stalker: 'WORKSPACE.SOURCES.STALKER_PLAYLISTS',
} as const;

/**
 * The Sources page: a 28px title with the visible count, Clean up (desktop,
 * with a count of sources that do not respond) and the sort menu, above the
 * list. The side list's filters live in `SourcesViewStateService`.
 */
@Component({
    selector: 'app-workspace-sources',
    imports: [
        MatButtonModule,
        MatDividerModule,
        MatIconModule,
        MatMenuModule,
        MenuItemRadioCheckDirective,
        MenuItemRadioDirective,
        RecentPlaylistsComponent,
        TranslatePipe,
    ],
    templateUrl: './workspace-sources.component.html',
    styleUrl: './workspace-sources.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceSourcesComponent {
    private readonly injector = inject(Injector);
    private readonly route = inject(ActivatedRoute);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly sortService = inject(SortService);
    private readonly statusService = inject(SourceStatusService);
    private readonly removal = inject(SourceRemovalService);
    private readonly viewState = inject(SourcesViewStateService);
    private readonly workspaceActions = inject(WORKSPACE_SHELL_ACTIONS);
    private readonly playback = inject(PORTAL_EXTERNAL_PLAYBACK, {
        optional: true,
    });
    private readonly imports = inject(WorkspaceShellXtreamImportService, {
        optional: true,
    });
    private readonly sourceList = viewChild(RecentPlaylistsComponent);
    private readonly languageTick = injectTranslationTick();

    readonly sortOptions = SOURCE_SORT_OPTIONS;
    readonly showFailingFirst = this.statusService.supportsStatusFilter;
    private readonly currentSort = toSignal(this.sortService.getSortOptions(), {
        requireSync: true,
    });
    readonly searchQuery = toSignal(
        this.route.queryParamMap.pipe(map((params) => params.get('q') ?? '')),
        { initialValue: '' }
    );

    private readonly allPlaylists = this.store.selectSignal(
        selectAllPlaylistsMeta
    );
    private readonly playlists = computed(() => {
        const pending = this.removal.pendingIds();
        return this.allPlaylists().filter((p) => !pending.has(p._id));
    });
    private readonly bucketOf: SourceBucketOf = (playlist) => {
        const status = this.statusService.statusOf(playlist);
        return status ? sourceStatusBucket(status.reachability) : null;
    };

    readonly hasPlaylists = computed(() => this.playlists().length > 0);
    readonly visibleCount = computed(() => {
        const filter = this.viewState.filter();
        return filterSources(
            this.playlists(),
            this.showFailingFirst ? filter : { ...filter, status: 'all' },
            this.searchQuery(),
            this.bucketOf
        ).length;
    });
    readonly title = computed(() => {
        this.languageTick();
        const filter = this.viewState.filter();
        const key =
            this.showFailingFirst && filter.status === 'bad'
                ? 'WORKSPACE.SOURCES.STATUS_BAD'
                : TYPE_TITLE_KEYS[filter.type];
        return this.translate.instant(key);
    });

    readonly canCleanSources = computed(
        () =>
            this.runtime.supportsSourceHealth &&
            this.playlists().some((p) => sourceHealthType(p))
    );
    /** Sources last seen not responding, across every filter. */
    readonly failingCount = computed(
        () => this.playlists().filter((p) => this.bucketOf(p) === 'bad').length
    );

    readonly activeSortLabel = computed(() => {
        this.languageTick();
        const current = this.currentSort();
        const match = this.sortOptions.find((option) =>
            isSortOptionActive(option, current)
        );
        return this.translate.instant(
            match?.translationKey ?? 'HOME.SORT_OPTIONS.NEWEST'
        );
    });
    readonly failingFirst = computed(() => !!this.currentSort().failingFirst);

    isSortActive(option: SourceSortOption): boolean {
        return isSortOptionActive(option, this.currentSort());
    }

    setSortOption(option: SourceSortOption): void {
        this.sortService.setSortOptions({
            ...this.currentSort(),
            by: option.by,
            order: option.order,
        });
    }

    toggleFailingFirst(): void {
        this.sortService.setSortOptions({
            ...this.currentSort(),
            failingFirst: !this.failingFirst(),
        });
    }

    onAddPlaylist(type?: WorkspacePlaylistType): void {
        this.workspaceActions.openAddPlaylistDialog(type);
    }

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
                    this.removal.isPending(id) ||
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
}

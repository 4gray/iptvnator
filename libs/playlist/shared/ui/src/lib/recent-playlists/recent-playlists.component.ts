import {
    CdkDragDrop,
    DragDropModule,
    moveItemInArray,
} from '@angular/cdk/drag-drop';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import {
    PlaylistActions,
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { SourceStatusService } from '@iptvnator/portal/shared/data-access';
import {
    filterSources,
    orderFailingFirst,
    PlaylistContextFacade,
    SourceBucketOf,
    SourcesViewStateService,
} from '@iptvnator/playlist/shared/util';
import {
    RuntimeCapabilitiesService,
    SortBy,
    SortService,
} from '@iptvnator/services';
import { PlaylistMeta, sourceStatusBucket } from '@iptvnator/shared/interfaces';
import type { PlaylistType } from '../add-playlist-menu/playlist-type';
import { SourceRemovalService } from '../source-removal/source-removal.service';
import { SourceRowComponent } from '../source-row/source-row.component';
import { EmptyStateComponent } from './empty-state/empty-state.component';
import { PlaylistInfoComponent } from './playlist-info/playlist-info.component';
import { SourceListRefreshService } from './source-list-refresh.service';

/**
 * The Sources page list: every source that passes the side list's type and
 * status filters and the header search, in the chosen sort order, as
 * `app-source-row`s. Sources being deleted (Undo pending) are left out.
 */
@Component({
    selector: 'app-recent-playlists',
    templateUrl: './recent-playlists.component.html',
    styleUrls: ['./recent-playlists.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [SourceListRefreshService],
    imports: [
        DragDropModule,
        EmptyStateComponent,
        MatButton,
        MatIcon,
        SourceRowComponent,
        TranslatePipe,
    ],
})
export class RecentPlaylistsComponent {
    private readonly dialog = inject(MatDialog);
    private readonly router = inject(Router);
    private readonly sortService = inject(SortService);
    private readonly store = inject(Store);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly statusService = inject(SourceStatusService);
    private readonly viewState = inject(SourcesViewStateService);
    readonly removal = inject(SourceRemovalService);
    readonly refresh = inject(SourceListRefreshService);

    readonly searchQueryInput = input<string>('');
    readonly playlistClicked = output<string>();
    readonly addPlaylistClicked = output<PlaylistType | undefined>();

    get isElectron(): boolean {
        return this.runtime.isElectron;
    }

    readonly allPlaylistsLoaded = this.store.selectSignal(
        selectPlaylistsLoadingFlag
    );
    private readonly allPlaylists = this.store.selectSignal(
        selectAllPlaylistsMeta
    );
    readonly activePlaylistId = this.playlistContext.resolvedPlaylistId;
    private readonly sortOptions = toSignal(this.sortService.getSortOptions(), {
        requireSync: true,
    });
    readonly isCustomSort = computed(
        () => this.sortOptions().by === SortBy.CUSTOM
    );
    readonly hasFilters = computed(() => {
        const filter = this.viewState.filter();
        return filter.type !== 'all' || filter.status !== 'all';
    });

    /** Every source except those whose delete is pending. */
    readonly playlists = computed(() => {
        const pending = this.removal.pendingIds();
        return this.allPlaylists().filter(
            (playlist) => !pending.has(playlist._id)
        );
    });

    readonly visiblePlaylists = computed(() => {
        const bucketOf: SourceBucketOf = (playlist) => {
            const status = this.statusService.statusOf(playlist);
            return status ? sourceStatusBucket(status.reachability) : null;
        };
        const options = this.sortOptions();
        const filter = this.viewState.filter();
        const filtered = filterSources(
            this.playlists(),
            this.statusService.supportsStatusFilter
                ? filter
                : { ...filter, status: 'all' },
            this.searchQueryInput(),
            bucketOf
        );
        const sorted = this.sortService.sortPlaylists(filtered, options);
        return options.failingFirst && options.by !== SortBy.CUSTOM
            ? orderFailingFirst(sorted, bucketOf)
            : sorted;
    });

    resetFilters(): void {
        this.viewState.reset();
    }

    /**
     * Applies a drag in custom order to the whole library: the shown rows
     * trade places among the slots they occupy, and sources a filter hides
     * keep theirs, so every position stays unique.
     */
    drop(event: CdkDragDrop<PlaylistMeta[]>): void {
        const visible = [...this.visiblePlaylists()];
        moveItemInArray(visible, event.previousIndex, event.currentIndex);
        const visibleIds = new Set(visible.map((item) => item._id));
        const ordered = this.sortService.sortPlaylists(
            this.allPlaylists(),
            this.sortOptions()
        );
        let shown = 0;
        const merged = ordered.map((item) =>
            visibleIds.has(item._id) ? visible[shown++] : item
        );
        this.store.dispatch(
            PlaylistActions.updatePlaylistPositions({
                positionUpdates: merged.map((item, index) => ({
                    id: item._id,
                    changes: { position: index },
                })),
            })
        );
    }

    open(playlist: PlaylistMeta): void {
        if (playlist.serverUrl) {
            void this.router.navigate(['/workspace', 'xtreams', playlist._id]);
        } else if (playlist.macAddress) {
            void this.router.navigate(['/workspace', 'stalker', playlist._id]);
        } else {
            void this.router.navigate([
                '/workspace',
                'playlists',
                playlist._id,
            ]);
            this.playlistClicked.emit(playlist._id);
        }
    }

    edit(playlist: PlaylistMeta): void {
        this.dialog.open(PlaylistInfoComponent, { data: playlist });
    }

    /** Deletes with Undo; the active source hands over to its neighbour. */
    remove(playlist: PlaylistMeta): void {
        if (this.refresh.isRefreshing(playlist._id)) {
            return;
        }
        const rows = this.visiblePlaylists();
        const index = rows.findIndex((item) => item._id === playlist._id);
        const next = rows[index + 1] ?? rows[index - 1] ?? null;
        this.removal.remove(playlist, next);
    }

    busyMessage(item: PlaylistMeta): string {
        return (
            this.removal.progress.message(item._id) ||
            this.refresh.message(item)
        );
    }

    busyProgress(item: PlaylistMeta): number | null {
        return this.removal.progress.isDeleting(item._id)
            ? this.removal.progress.progress(item._id)
            : this.refresh.progress(item._id);
    }

    canCancelBusy(item: PlaylistMeta): boolean {
        return (
            this.removal.progress.canCancel(item._id) ||
            this.refresh.canCancel(item)
        );
    }

    cancelBusy(item: PlaylistMeta): void {
        if (this.removal.progress.isDeleting(item._id)) {
            void this.removal.progress.cancel(item._id);
        } else {
            void this.refresh.cancel(item);
        }
    }

    onAddPlaylist(type?: PlaylistType): void {
        this.addPlaylistClicked.emit(type);
    }

    isDeletePending(playlistId: string): boolean {
        return this.removal.isPending(playlistId);
    }

    isRefreshPending(playlistId: string): boolean {
        return this.refresh.isRefreshing(playlistId);
    }
}

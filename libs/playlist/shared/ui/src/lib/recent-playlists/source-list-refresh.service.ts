import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    DatabaseService,
    DataService,
    DbOperationEvent,
    isDbAbortError,
    PlaylistRefreshService,
    RuntimeCapabilitiesService,
    SourceActivityService,
} from '@iptvnator/services';
import {
    PLAYLIST_UPDATE,
    PlaylistMeta,
    PlaylistRefreshEvent,
} from '@iptvnator/shared/interfaces';
import {
    XtreamRefreshFlowService,
    type XtreamRefreshProgressReporter,
} from '../xtream-refresh-flow.service';

interface BusyOperation {
    current?: number;
    operation: string;
    operationId?: string;
    phase?: string;
    status: DbOperationEvent['status'];
    total?: number;
}

const REFRESH_PHASE_KEYS: Record<string, string> = {
    fetching: 'HOME.PLAYLISTS.REFRESH_FETCHING',
    'reading-file': 'HOME.PLAYLISTS.REFRESH_READING_FILE',
    parsing: 'HOME.PLAYLISTS.REFRESH_PARSING',
    saving: 'HOME.PLAYLISTS.REFRESH_SAVING',
};
const XTREAM_PHASE_KEYS: Record<string, string> = {
    'collecting-user-data':
        'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.COLLECTING_DATA',
    'deleting-content': 'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.DELETING_CONTENT',
    'deleting-categories':
        'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.DELETING_CATEGORIES',
};

/**
 * The Sources page's per-row refresh: which rows refresh, their phase and
 * progress, and cancelling. M3U refreshes in place, Xtream re-imports
 * through the shared confirmation flow, and the browser build sends the
 * URL refresh event. Provided by the list component.
 */
@Injectable()
export class SourceListRefreshService {
    private readonly databaseService = inject(DatabaseService);
    private readonly dataService = inject(DataService);
    private readonly playlistRefreshService = inject(PlaylistRefreshService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    // Root registry: the switcher, the removal guard and cleanup consult it,
    // so a row refresh must not be visible only to this page.
    private readonly activity = inject(SourceActivityService);
    private readonly releases = new Map<string, () => void>();
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly xtreamRefreshFlow = inject(XtreamRefreshFlowService);
    private readonly logger = createLogger('SourceListRefresh');

    private readonly refreshingIds = signal<ReadonlySet<string>>(new Set());
    private readonly operations = signal<ReadonlyMap<string, BusyOperation>>(
        new Map()
    );

    isRefreshing(id: string): boolean {
        return this.refreshingIds().has(id);
    }

    canRefresh(item: PlaylistMeta): boolean {
        if (item.serverUrl) {
            return this.runtime.supportsXtreamSqliteDataSource;
        }
        return (
            !!item.url ||
            (!!item.filePath && this.runtime.supportsPlaylistRefresh)
        );
    }

    refresh(item: PlaylistMeta): void {
        if (this.isRefreshing(item._id) || this.activity.isBusy(item._id)) {
            return;
        }
        if (item.serverUrl && this.runtime.supportsXtreamSqliteDataSource) {
            this.xtreamRefreshFlow.confirmAndRefresh(item, this.xtreamReporter);
        } else if (
            this.runtime.supportsPlaylistRefresh &&
            (item.url || item.filePath)
        ) {
            void this.refreshM3u(item);
        } else if (item.url) {
            void this.refreshViaBackend(item, item.url);
        }
    }

    message(item: PlaylistMeta): string {
        const operation = this.operations().get(item._id);
        if (!operation) {
            return '';
        }
        if (operation.operation === 'playlist-refresh') {
            return this.translate.instant(
                REFRESH_PHASE_KEYS[operation.phase ?? ''] ??
                    'HOME.PLAYLISTS.REFRESH'
            );
        }
        if (operation.operation === 'delete-xtream-content') {
            return this.translate.instant(
                XTREAM_PHASE_KEYS[operation.phase ?? ''] ??
                    'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.IN_PROGRESS'
            );
        }
        return '';
    }

    progress(id: string): number | null {
        const operation = this.operations().get(id);
        if (
            !operation ||
            operation.current == null ||
            operation.total == null ||
            operation.total <= 0
        ) {
            return null;
        }
        return Math.min(
            100,
            Math.round((operation.current / operation.total) * 100)
        );
    }

    canCancel(item: PlaylistMeta): boolean {
        const operation = this.operations().get(item._id);
        if (!operation?.operationId) {
            return false;
        }
        return (
            operation.operation === 'playlist-refresh' ||
            Boolean(item.serverUrl)
        );
    }

    async cancel(item: PlaylistMeta): Promise<void> {
        const operation = this.operations().get(item._id);
        if (!operation?.operationId) {
            return;
        }
        if (operation.operation === 'playlist-refresh') {
            await this.playlistRefreshService.cancelRefresh(
                operation.operationId
            );
            return;
        }
        await this.databaseService.cancelOperation(operation.operationId);
    }

    /** The shared Xtream re-import reports into this list's row state. */
    private readonly xtreamReporter: XtreamRefreshProgressReporter = {
        isBusy: (playlistId) =>
            this.isRefreshing(playlistId) || this.activity.isBusy(playlistId),
        begin: ({ playlistId }) => this.setRefreshing(playlistId, true),
        report: ({ playlistId }, event) => this.track(playlistId, event),
        end: ({ playlistId }) => {
            this.clear(playlistId);
            this.setRefreshing(playlistId, false);
        },
    };

    private async refreshM3u(item: PlaylistMeta): Promise<void> {
        this.setRefreshing(item._id, true);
        const operationId =
            this.databaseService.createOperationId('playlist-refresh');
        try {
            const refreshed = await this.playlistRefreshService.refreshPlaylist(
                {
                    operationId,
                    playlistId: item._id,
                    title: item.title,
                    url: item.url,
                    ...(item.userAgent ? { userAgent: item.userAgent } : {}),
                    filePath: item.filePath,
                },
                {
                    onEvent: (event) =>
                        this.track(item._id, this.toBusyEvent(event)),
                }
            );
            this.store.dispatch(
                PlaylistActions.updatePlaylist({
                    playlist: { ...refreshed, _id: item._id },
                    playlistId: item._id,
                    refreshEpg: true,
                    operationId,
                })
            );
            this.snackBar.open(
                this.translate.instant(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'
                ),
                undefined,
                { duration: 2000 }
            );
        } catch (error) {
            if (!isDbAbortError(error)) {
                // Redacted: the error can carry the playlist URL.
                this.logger.error('Error refreshing playlist:', error);
                this.snackBar.open(
                    this.refreshErrorMessage(error, item),
                    this.translate.instant('CLOSE'),
                    { duration: 5000 }
                );
            }
        } finally {
            this.clear(item._id);
            this.setRefreshing(item._id, false);
        }
    }

    /**
     * The browser build refreshes through the backend; the row stays busy,
     * and held in the shared registry, until the backend answers.
     */
    private async refreshViaBackend(
        item: PlaylistMeta,
        url: string
    ): Promise<void> {
        this.setRefreshing(item._id, true);
        try {
            await this.dataService.sendIpcEvent(PLAYLIST_UPDATE, {
                id: item._id,
                title: item.title,
                url,
                ...(item.userAgent ? { userAgent: item.userAgent } : {}),
            });
        } catch (error) {
            this.logger.error('Error refreshing playlist:', error);
        } finally {
            this.setRefreshing(item._id, false);
        }
    }

    private refreshErrorMessage(error: unknown, item: PlaylistMeta): string {
        if (item.filePath) {
            const message = String(
                (error as { message?: string })?.message ?? error
            );
            if (/(ENOENT|no such file or directory|not found)/i.test(message)) {
                return this.translate.instant(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_FILE_NOT_FOUND'
                );
            }
            if (/(EACCES|EPERM|permission denied)/i.test(message)) {
                return this.translate.instant(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_FILE_ACCESS_ERROR'
                );
            }
        }
        return this.translate.instant('HOME.PLAYLISTS.PLAYLIST_UPDATE_ERROR');
    }

    private toBusyEvent(event: PlaylistRefreshEvent): DbOperationEvent {
        return {
            operationId: event.operationId,
            operation: 'playlist-refresh',
            playlistId: event.playlistId,
            phase: event.phase,
            status: event.status,
            error: event.error,
        };
    }

    private track(id: string, event: DbOperationEvent): void {
        this.operations.update((current) => {
            const next = new Map(current);
            if (['completed', 'cancelled', 'error'].includes(event.status)) {
                next.delete(id);
            } else {
                next.set(id, {
                    operation: event.operation,
                    operationId: event.operationId,
                    phase: event.phase,
                    current: event.current,
                    total: event.total,
                    status: event.status,
                });
            }
            return next;
        });
    }

    private clear(id: string): void {
        this.operations.update((current) => {
            const next = new Map(current);
            next.delete(id);
            return next;
        });
    }

    private setRefreshing(id: string, refreshing: boolean): void {
        if (refreshing && !this.releases.has(id)) {
            this.releases.set(id, this.activity.begin([id]));
        } else if (!refreshing) {
            this.releases.get(id)?.();
            this.releases.delete(id);
        }
        this.refreshingIds.update((current) => {
            const next = new Set(current);
            if (refreshing) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }
}

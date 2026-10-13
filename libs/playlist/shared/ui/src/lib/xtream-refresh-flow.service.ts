import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DialogService } from '@iptvnator/ui/components';
import {
    DataService,
    DatabaseService,
    type DbOperationEvent,
    isDbAbortError,
    PlaybackPositionService,
    resetHostConnectivityGuard,
    SourceActivityService,
    XtreamPendingRestoreService,
} from '@iptvnator/services';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    measureRendererPerformancePhase,
    RENDERER_PERFORMANCE_PHASE,
} from '@iptvnator/shared/logging';

/** Identifies one confirmed run, so a reporter can scope its own state to it. */
export interface XtreamRefreshRun {
    readonly playlistId: string;
    readonly operationId: string;
}

/**
 * How an entry point shows that the refresh is working. The flow itself owns no
 * busy state: the header action renders one global preparation overlay while
 * the sources page renders a per-row indicator, and those cannot be unified
 * without changing what either page looks like.
 */
export interface XtreamRefreshProgressReporter {
    /**
     * Re-checked after the user confirms. The dialog is asynchronous, so the
     * playlist may have picked up another operation (or this very refresh) in
     * the meantime.
     */
    isBusy(playlistId: string): boolean;

    /** Marks the run busy. Runs synchronously, before anything is awaited. */
    begin(run: XtreamRefreshRun): void;

    /** Progress from the delete worker. */
    report(run: XtreamRefreshRun, event: DbOperationEvent): void;

    /** Clears the busy state. Always runs, including after an abort. */
    end(run: XtreamRefreshRun): void;

    /**
     * Optional pause between `begin()` and the destructive work, for a reporter
     * whose indicator needs a paint opportunity — a small cached playlist can
     * otherwise finish deleting before its progress UI ever appears.
     */
    waitForVisibleProgress?(): Promise<void>;
}

/**
 * The destructive Xtream refresh: drop the cached catalog, park the user data
 * that must survive it, and navigate so the portal route re-imports everything.
 *
 * This lives on its own because it has two entry points — the shared playlist
 * refresh action and the Workspace sources page — that differ only in how they
 * report progress. They used to be two near-identical implementations, and a
 * connectivity-guard fix applied to one of them looked applied to both (#1421).
 */
@Injectable({ providedIn: 'root' })
export class XtreamRefreshFlowService {
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly dialogService = inject(DialogService);
    private readonly databaseService = inject(DatabaseService);
    private readonly dataService = inject(DataService);
    private readonly playbackPositionService = inject(PlaybackPositionService);
    private readonly pendingRestoreService = inject(
        XtreamPendingRestoreService
    );
    private readonly activity = inject(SourceActivityService);

    /**
     * Playlists with a destructive run in flight, across every entry point.
     *
     * A reporter only ever knows its own: the header action tracks one global
     * flag, the sources row tracks its own id set, and neither disables the
     * other's button. Both can therefore be confirmed for the same playlist
     * inside the delete window, and the second run would collect an
     * already-emptied catalog and park it over the first run's snapshot —
     * losing favorites, history, hidden categories and playback positions on
     * re-import. This service is the only place that sees both.
     */
    private readonly activeRefreshPlaylistIds = signal<ReadonlySet<string>>(
        new Set()
    );

    /**
     * Whether a destructive run is in flight for the playlist. Opening the
     * playlist meanwhile would start its import against a half-deleted
     * catalog, before the user data to restore has been parked.
     */
    isRunning(playlistId: string): boolean {
        return this.activeRefreshPlaylistIds().has(playlistId);
    }

    private setRunning(playlistId: string, running: boolean): void {
        this.activeRefreshPlaylistIds.update((current) => {
            const next = new Set(current);
            if (running) {
                next.add(playlistId);
            } else {
                next.delete(playlistId);
            }
            return next;
        });
    }

    /**
     * Asks for confirmation, then deletes and re-imports the playlist. Callers
     * keep their own entry-point guard (a disabled button, a pending row) —
     * this only re-checks `reporter.isBusy()` once the dialog is confirmed.
     */
    confirmAndRefresh(
        item: PlaylistMeta,
        reporter: XtreamRefreshProgressReporter
    ): void {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant(
                'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.TITLE'
            ),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.MESSAGE'
            ),
            confirmLabel: this.translate.instant('HOME.PLAYLISTS.REFRESH'),
            width: '400px',
            onConfirm: () => this.runRefresh(item, reporter),
        });
    }

    private async runRefresh(
        item: PlaylistMeta,
        reporter: XtreamRefreshProgressReporter
    ): Promise<void> {
        // The shared registry also holds deletes, the startup auto-refresh
        // and M3U refreshes from either entry point.
        if (
            this.isRunning(item._id) ||
            this.activity.isBusy(item._id) ||
            reporter.isBusy(item._id)
        ) {
            return;
        }

        const operationId =
            this.databaseService.createOperationId('xtream-refresh');
        const run: XtreamRefreshRun = { playlistId: item._id, operationId };
        reporter.begin(run);
        this.setRunning(item._id, true);
        const release = this.activity.begin([item._id]);

        try {
            // Before anything destructive: this deletes the cached catalog and
            // then forces a route bootstrap whose status request an open
            // connectivity guard would fast-fail, leaving the user with no
            // catalog at all until the cooldown expires. Both entry points
            // reach the reset through here, which is the point of the shared
            // flow — see docs/architecture/host-connectivity-guard.md.
            await resetHostConnectivityGuard(this.dataService, item.serverUrl);

            // Show immediate feedback — deletion can take several seconds for
            // large playlists.
            this.snackBar.open(
                this.translate.instant(
                    'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.STARTED'
                ),
                undefined,
                { duration: 2000 }
            );
            await reporter.waitForVisibleProgress?.();

            // Delete content/categories and update the timestamp in parallel —
            // all three operations are fully independent.
            const updateDate = Date.now();
            const [restoreState, playbackPositions] = await Promise.all([
                this.databaseService.deleteXtreamPlaylistContent(item._id, {
                    operationId,
                    onEvent: (event) => reporter.report(run, event),
                }),
                this.playbackPositionService.getAllPlaybackPositions(item._id),
                this.databaseService.updateXtreamPlaylistDetails({
                    id: item._id,
                    updateDate,
                }),
            ]);

            if (
                !this.pendingRestoreService.set(item._id, {
                    ...restoreState,
                    playbackPositions,
                })
            ) {
                throw new Error(
                    `Parking pending restore state for "${item._id}" failed.`
                );
            }

            // Update the timestamp in NgRx / IndexedDB
            measureRendererPerformancePhase(
                RENDERER_PERFORMANCE_PHASE.XTREAM_REFRESH_META,
                () =>
                    this.store.dispatch(
                        PlaylistActions.updatePlaylistMeta({
                            playlist: { ...item, updateDate },
                        })
                    ),
                () => ({ items: 1 })
            );

            // Navigate to the playlist to trigger re-import
            await this.router.navigate(['/workspace', 'xtreams', item._id]);
        } catch (error) {
            if (!isDbAbortError(error)) {
                console.error('Error refreshing Xtream playlist:', error);
                this.snackBar.open(
                    this.translate.instant(
                        'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.ERROR'
                    ),
                    undefined,
                    { duration: 3000 }
                );
            }
        } finally {
            this.setRunning(item._id, false);
            release();
            reporter.end(run);
        }
    }
}

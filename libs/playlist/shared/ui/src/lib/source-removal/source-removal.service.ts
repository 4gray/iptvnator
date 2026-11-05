import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar, MatSnackBarRef } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    PlaylistContextFacade,
    sourceDisplayName,
} from '@iptvnator/playlist/shared/util';
import {
    PlaylistDeleteActionService,
    RuntimeCapabilitiesService,
    SourceActivityService,
} from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { SourceDeleteProgressService } from './source-delete-progress.service';
import { SourceRemovalToastComponent } from './source-removal-toast.component';
import {
    measureRendererPerformancePhase,
    RENDERER_PERFORMANCE_PHASE,
} from '@iptvnator/shared/logging';

/** How long Undo stays available before the delete is committed. */
export const SOURCE_REMOVAL_UNDO_MS = 4000;

export interface SourceRemovalOptions {
    /**
     * For a surface that closes on delete, such as the switcher popover,
     * whose focus trap the toast sits outside: Undo takes the focus at once,
     * and it comes back here when the toast closes.
     */
    returnFocusTo?: HTMLElement | null;
}

interface PendingRemoval {
    playlist: PlaylistMeta;
    /** Its Undo toast, set once opened. */
    snackBar?: MatSnackBarRef<SourceRemovalToastComponent>;
    /** The playlist was the active one; `next` replaced it, if any. */
    wasActive: boolean;
    wasOnItsRoute: boolean;
    previousUrl: string;
    next: PlaylistMeta | null;
    undone: boolean;
    /** Undone or committed: nothing more happens to it. */
    settled: boolean;
    /** Commits when the Undo window ends, whatever happened to the toast. */
    timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Single-source delete with Undo, for the Sources page and the switcher.
 *
 * Deleting a source drops its favourites, history and playback progress, so
 * nothing is deleted while Undo is offered: the source only leaves the
 * lists (`pendingIds`), and the real delete runs when the toast closes
 * without Undo. Quitting the app inside those four seconds keeps the
 * source. The window is the service's own timer, not the toast's: another
 * message can replace the toast early without shortening it. One removal
 * is pending at a time; a second delete commits the
 * first. A delete that reports progress (a large Xtream catalog) brings its
 * row back as "Removing…" with Cancel, which keeps the source. Bulk cleanup
 * keeps its confirmation dialog instead.
 */
@Injectable({ providedIn: 'root' })
export class SourceRemovalService {
    private readonly deleteAction = inject(PlaylistDeleteActionService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly activity = inject(SourceActivityService);
    private readonly router = inject(Router);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    /** Progress of a long delete; its row comes back to show it. */
    readonly progress = inject(SourceDeleteProgressService);

    private readonly pendingState = signal<ReadonlySet<string>>(new Set());
    /** Sources hidden from every list while Undo or the delete runs. */
    readonly pendingIds = this.pendingState.asReadonly();
    private pending: PendingRemoval | null = null;

    isPending(id: string): boolean {
        return this.pendingState().has(id);
    }

    /**
     * Whether a source can become active in place of a removed one: not
     * leaving itself, and not held by a refresh, import or delete, since
     * opening it would start an import against a catalog being rewritten.
     */
    canTakeOver(id: string): boolean {
        return (
            !this.isPending(id) &&
            !this.progress.isDeleting(id) &&
            !this.activity.isBusy(id)
        );
    }

    /**
     * @param next The source to switch to when `playlist` is the active one:
     * the caller's next row, so the switch follows the list on screen.
     */
    remove(
        playlist: PlaylistMeta,
        next: PlaylistMeta | null = null,
        options: SourceRemovalOptions = {}
    ): void {
        // A refresh from any entry point (or the startup auto-refresh) is
        // destructive too: it clears the catalog, then re-imports it.
        if (
            this.isPending(playlist._id) ||
            this.activity.isBusy(playlist._id)
        ) {
            return;
        }
        // A second delete commits the first at once.
        if (this.pending) {
            this.settle(this.pending);
        }

        const wasActive =
            this.playlistContext.resolvedPlaylistId() === playlist._id;
        const wasOnItsRoute =
            this.playlistContext.routePlaylistId() === playlist._id;
        const previousUrl = this.router.url;
        const replacement =
            wasActive && next && this.canTakeOver(next._id) ? next : null;
        this.setPending(playlist._id, true);

        if (replacement) {
            this.playlistContext.selectPlaylist(replacement);
        } else if (wasOnItsRoute) {
            void this.router.navigate(['/workspace', 'sources']);
        }

        const name = this.nameOf(playlist);
        const message = replacement
            ? this.translate.instant('WORKSPACE.SOURCES.REMOVED_SWITCHED', {
                  name,
                  next: this.nameOf(replacement),
              })
            : this.translate.instant('WORKSPACE.SOURCES.REMOVED', { name });
        const removal: PendingRemoval = {
            playlist,
            wasActive,
            wasOnItsRoute,
            previousUrl,
            next: replacement,
            undone: false,
            settled: false,
            timer: undefined,
        };
        const snackBar = this.snackBar.openFromComponent(
            SourceRemovalToastComponent,
            {
                data: {
                    message,
                    undoLabel: this.translate.instant(
                        'PORTALS.MULTI_SOURCE.UNDO'
                    ),
                    closeLabel: this.translate.instant('CLOSE'),
                    returnFocusTo: options.returnFocusTo ?? null,
                    commitNow: () => this.settle(removal),
                },
                duration: SOURCE_REMOVAL_UNDO_MS,
                panelClass: 'app-toast',
            }
        );
        removal.snackBar = snackBar;
        removal.timer = setTimeout(
            () => this.settle(removal),
            SOURCE_REMOVAL_UNDO_MS
        );
        this.pending = removal;
        snackBar.onAction().subscribe(() => this.undo(removal));
    }

    /** Ends the Undo window: commits the delete unless it was undone. */
    private settle(removal: PendingRemoval): void {
        if (removal.settled) {
            return;
        }
        removal.settled = true;
        clearTimeout(removal.timer);
        if (this.pending === removal) {
            this.pending = null;
        }
        removal.snackBar?.dismiss();
        if (!removal.undone) {
            void this.commit(removal);
        }
    }

    private undo(removal: PendingRemoval): void {
        if (removal.settled) {
            return;
        }
        removal.undone = true;
        this.settle(removal);
        this.setPending(removal.playlist._id, false);
        if (!removal.wasActive) {
            return;
        }
        // Only take the user back if they are still where the delete left
        // them: on its replacement, or with no other source chosen. A switch
        // they made since then wins, also when nothing replaced the source
        // (it was the only row a filter showed).
        const current = this.playlistContext.resolvedPlaylistId();
        const untouched =
            current === null ||
            current === removal.playlist._id ||
            current === removal.next?._id;
        if (!untouched) {
            return;
        }
        if (removal.wasOnItsRoute) {
            void this.router.navigateByUrl(removal.previousUrl);
        } else {
            this.playlistContext.activatePlaylist(removal.playlist._id);
        }
    }

    private async commit(removal: PendingRemoval): Promise<void> {
        const { playlist } = removal;
        // A desktop Xtream delete works through the catalog database and
        // reports progress: its row returns at once as "Removing…".
        if (playlist.serverUrl && this.runtime.supportsXtreamSqliteDataSource) {
            this.progress.track(playlist._id, {
                operation: 'delete-playlist',
                status: 'started',
            });
            this.setPending(playlist._id, false);
        }
        try {
            const deleted = await this.deleteAction.deletePlaylist(playlist, {
                onEvent: (event) => {
                    this.progress.track(playlist._id, event);
                    if (this.progress.isDeleting(playlist._id)) {
                        this.setPending(playlist._id, false);
                    }
                },
            });
            if (deleted) {
                const commit = () =>
                    this.store.dispatch(
                        PlaylistActions.playlistRemovalCommitted({
                            playlistId: playlist._id,
                        })
                    );
                // The performance journeys time an Xtream row leaving the store.
                if (playlist.serverUrl) {
                    measureRendererPerformancePhase(
                        RENDERER_PERFORMANCE_PHASE.XTREAM_DELETE_ROW,
                        commit,
                        () => ({ items: 1 })
                    );
                } else {
                    commit();
                }
            } else if (!this.progress.takeCancelled(playlist._id)) {
                this.snackBar.open(
                    this.translate.instant('WORKSPACE.SOURCES.REMOVE_FAILED', {
                        name: this.nameOf(playlist),
                    }),
                    this.translate.instant('CLOSE'),
                    { duration: 5000, panelClass: 'app-toast' }
                );
            }
        } finally {
            this.progress.clear(playlist._id);
            this.setPending(playlist._id, false);
        }
    }

    private nameOf(playlist: PlaylistMeta): string {
        return (
            sourceDisplayName(playlist) ??
            this.translate.instant('HOME.PLAYLISTS.UNTITLED_PLAYLIST')
        );
    }

    private setPending(id: string, pending: boolean): void {
        this.pendingState.update((current) => {
            const next = new Set(current);
            if (pending) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }
}

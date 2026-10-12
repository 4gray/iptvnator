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

interface PendingRemoval {
    playlist: PlaylistMeta;
    snackBar: MatSnackBarRef<SourceRemovalToastComponent>;
    /** The playlist was the active one; `next` replaced it, if any. */
    wasActive: boolean;
    wasOnItsRoute: boolean;
    previousUrl: string;
    next: PlaylistMeta | null;
    undone: boolean;
}

/**
 * Single-source delete with Undo, for the Sources page and the switcher.
 *
 * Deleting a source drops its favourites, history and playback progress, so
 * nothing is deleted while Undo is offered: the source only leaves the
 * lists (`pendingIds`), and the real delete runs when the toast closes
 * without Undo. Quitting the app inside those four seconds keeps the
 * source. One removal is pending at a time; a second delete commits the
 * first. A delete that reports progress (a large Xtream catalog) brings its
 * row back as "Removing…" with Cancel, which keeps the source. Bulk cleanup
 * keeps its confirmation dialog instead.
 */
@Injectable({ providedIn: 'root' })
export class SourceRemovalService {
    private readonly deleteAction = inject(PlaylistDeleteActionService);
    private readonly playlistContext = inject(PlaylistContextFacade);
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
     * @param next The source to switch to when `playlist` is the active one:
     * the caller's next row, so the switch follows the list on screen.
     */
    remove(playlist: PlaylistMeta, next: PlaylistMeta | null = null): void {
        if (this.isPending(playlist._id)) {
            return;
        }
        // The toast for an earlier removal closes here and commits it.
        this.pending?.snackBar.dismiss();

        const wasActive =
            this.playlistContext.resolvedPlaylistId() === playlist._id;
        const wasOnItsRoute =
            this.playlistContext.routePlaylistId() === playlist._id;
        const previousUrl = this.router.url;
        const replacement = wasActive ? next : null;
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
        const snackBar = this.snackBar.openFromComponent(
            SourceRemovalToastComponent,
            {
                data: {
                    message,
                    undoLabel: this.translate.instant(
                        'PORTALS.MULTI_SOURCE.UNDO'
                    ),
                    closeLabel: this.translate.instant('CLOSE'),
                },
                duration: SOURCE_REMOVAL_UNDO_MS,
                panelClass: 'app-toast',
            }
        );
        const removal: PendingRemoval = {
            playlist,
            snackBar,
            wasActive,
            wasOnItsRoute,
            previousUrl,
            next: replacement,
            undone: false,
        };
        this.pending = removal;

        snackBar.onAction().subscribe(() => this.undo(removal));
        snackBar.afterDismissed().subscribe(() => {
            if (this.pending === removal) {
                this.pending = null;
            }
            if (!removal.undone) {
                void this.commit(removal);
            }
        });
    }

    private undo(removal: PendingRemoval): void {
        removal.undone = true;
        this.setPending(removal.playlist._id, false);
        if (!removal.wasActive) {
            return;
        }
        // Only take the user back if they are still where the delete left
        // them; a switch they made since then wins.
        const stillReplaced =
            this.playlistContext.resolvedPlaylistId() ===
            (removal.next?._id ?? null);
        if (!stillReplaced && removal.next) {
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

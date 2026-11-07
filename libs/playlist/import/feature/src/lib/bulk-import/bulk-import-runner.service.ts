import { inject, Injectable, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    DatabaseService,
    DataService,
    ParentalLockService,
    PlaylistDeleteActionService,
    PlaylistsService,
    PlaylistStorageBackend,
    PORTAL_CONTENT_SEEDERS,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { applyImportScopeToPlaylist } from '@iptvnator/shared/m3u-utils';
import {
    BulkImportEntry,
    bulkEntryToPlaylist,
    isDirectBulkPlaylistEntry,
    storedImportScopeFlags,
    type Playlist,
} from '@iptvnator/shared/interfaces';

/** Time one source gets to download and store its catalog. */
export const BULK_IMPORT_SOURCE_TIMEOUT_MS = 60_000;

const POPUP_MS = 4000;

export type BulkImportRowStatus =
    'pending' | 'importing' | 'imported' | 'slow' | 'failed';

export interface BulkImportSummary {
    imported: number;
    slow: number;
    failed: number;
}

/** Shared between a row's import and its timeout. */
interface RowAttempt {
    /** Set once the row was given up; late steps must not persist it. */
    abandoned: boolean;
    /** The row as stored, once it was written. */
    persisted: Playlist | null;
    /** Aborted when the row is given up, so its seeding stops too. */
    signal: AbortSignal;
}

class SourceTimeoutError extends Error {}

/**
 * Runs a bulk import as one replace operation: every existing source is
 * removed first, then the file's sources import one at a time. Each source
 * gets {@link BULK_IMPORT_SOURCE_TIMEOUT_MS} to download and store its
 * catalog; a slower one is skipped with a "too slow" popup, a failing one
 * with an error popup, and the run continues until every row was tried. A
 * skipped source is removed again, so only working sources remain.
 *
 * Root-provided so the run (and its popups) outlives the dialog when the
 * user closes it before the last source finished.
 */
@Injectable({ providedIn: 'root' })
export class BulkImportRunnerService {
    private readonly store = inject(Store);
    private readonly router = inject(Router);
    private readonly dataService = inject(DataService);
    private readonly databaseService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly playlistBackend = inject(PlaylistStorageBackend);
    private readonly parentalLock = inject(ParentalLockService);
    private readonly deleteAction = inject(PlaylistDeleteActionService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly seeders =
        inject(PORTAL_CONTENT_SEEDERS, { optional: true }) ?? [];

    private popups = Promise.resolve();

    readonly running = signal(false);
    /** Progress per bulk row id, for the dialog's row list. */
    readonly statuses = signal<Readonly<Record<string, BulkImportRowStatus>>>(
        {}
    );

    /** Null when a run is already active or the old sources stayed. */
    async run(
        rows: readonly BulkImportEntry[]
    ): Promise<BulkImportSummary | null> {
        if (this.running() || rows.length === 0) {
            return null;
        }
        this.running.set(true);
        this.statuses.set(
            rows.reduce<Record<string, BulkImportRowStatus>>((all, row) => {
                all[row.id] = 'pending';
                return all;
            }, {})
        );
        try {
            if (!(await this.removeExistingSources())) {
                this.notify('HOME.ADD_PLAYLIST.BULK_REPLACE_FAILED');
                return null;
            }
            const summary: BulkImportSummary = {
                imported: 0,
                slow: 0,
                failed: 0,
            };
            let firstImported: Playlist | null = null;
            for (const row of rows) {
                this.setStatus(row.id, 'importing');
                const { status, playlist } = await this.importRow(row);
                this.setStatus(row.id, status);
                summary[status] += 1;
                firstImported ??= playlist;
            }
            this.notify('HOME.ADD_PLAYLIST.BULK_IMPORT_FINISHED', summary);
            if (firstImported) {
                await this.router.navigate(sourceRoute(firstImported));
            }
            return summary;
        } finally {
            this.running.set(false);
        }
    }

    /** Mirrors Settings → Remove all sources. */
    private async removeExistingSources(): Promise<boolean> {
        try {
            const deleted =
                this.runtime.isElectron && window.electron
                    ? await this.databaseService.deleteAllPlaylists({
                          operationId: this.databaseService.createOperationId(
                              'bulk-import-replace'
                          ),
                      })
                    : await firstValueFrom(
                          this.playlistsService.removeAll()
                      ).then(() => true);
            if (!deleted) {
                return false;
            }
            if (this.playlistBackend.kind() !== 'server') {
                await this.parentalLock.clearAllLocks();
            }
            this.store.dispatch(PlaylistActions.removeAllPlaylists());
            return true;
        } catch {
            return false;
        }
    }

    private async importRow(row: BulkImportEntry): Promise<{
        status: 'imported' | 'slow' | 'failed';
        playlist: Playlist | null;
    }> {
        const controller = new AbortController();
        const attempt: RowAttempt = {
            abandoned: false,
            persisted: null,
            signal: controller.signal,
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                // Stop the abandoned download itself, not just waiting for it.
                controller.abort();
                reject(new SourceTimeoutError());
            }, BULK_IMPORT_SOURCE_TIMEOUT_MS);
        });
        try {
            const playlist = await Promise.race([
                this.importSource(row, attempt),
                timeout,
            ]);
            this.store.dispatch(
                PlaylistActions.addManyPlaylists({
                    playlists: [playlist],
                    persist: false,
                })
            );
            return { status: 'imported', playlist };
        } catch (error) {
            attempt.abandoned = true;
            controller.abort();
            const slow = error instanceof SourceTimeoutError;
            this.notify(
                slow
                    ? 'HOME.ADD_PLAYLIST.BULK_SOURCE_TOO_SLOW'
                    : 'HOME.ADD_PLAYLIST.BULK_SOURCE_FAILED',
                { title: row.title }
            );
            if (attempt.persisted) {
                await this.deleteAction.deletePlaylist(attempt.persisted);
            }
            return { status: slow ? 'slow' : 'failed', playlist: null };
        } finally {
            clearTimeout(timer);
        }
    }

    /** Resolves with the stored source once its catalog is in place. */
    private async importSource(
        row: BulkImportEntry,
        attempt: RowAttempt
    ): Promise<Playlist> {
        if (isDirectBulkPlaylistEntry(row)) {
            let playlist = bulkEntryToPlaylist(row);
            if (!playlist) {
                throw new Error('Incomplete portal row');
            }
            await this.persist(playlist, attempt);
            for (const seeder of this.seeders) {
                const seeded = await seeder.seed(playlist, attempt.signal);
                // A seeder may resolve the real endpoint: a Stalker list
                // names the portal page, not the API. Store and show THAT row.
                if (seeded) {
                    playlist = seeded;
                }
            }
            return playlist;
        }

        const scope = storedImportScopeFlags(row);
        const disableVod = this.settingsStore.disableVod?.() === true;
        let playlist: Playlist;
        if (row.kind === 'm3u-url' && row.candidate.url) {
            const fetched = await this.dataService.fetchPlaylistDefinition(
                row.candidate.url
            );
            playlist = applyImportScopeToPlaylist(
                { ...fetched, title: row.title, filename: row.title },
                scope,
                disableVod
            );
        } else if (row.kind === 'm3u-text' && row.candidate.text) {
            playlist = await this.playlistsService.handlePlaylistParsing(
                'TEXT',
                row.candidate.text,
                row.title,
                undefined,
                scope,
                disableVod
            );
        } else {
            throw new Error('Unsupported bulk row');
        }
        await this.persist(playlist, attempt);
        return playlist;
    }

    private async persist(
        playlist: Playlist,
        attempt: RowAttempt
    ): Promise<void> {
        // A download that finished after the timeout must not bring the
        // skipped source back.
        if (attempt.abandoned) {
            throw new SourceTimeoutError();
        }
        await firstValueFrom(
            this.playlistsService.addManyPlaylists([playlist])
        );
        if (attempt.abandoned) {
            // Timed out while the write was in flight: the timeout found
            // nothing to remove yet, so the late write is undone here.
            await this.deleteAction.deletePlaylist(playlist);
            throw new SourceTimeoutError();
        }
        attempt.persisted = playlist;
    }

    private setStatus(id: string, status: BulkImportRowStatus): void {
        this.statuses.update((all) => ({ ...all, [id]: status }));
    }

    /**
     * Popups queue rather than replace each other: a source that fails in
     * a few milliseconds must not wipe the previous source's message before
     * anyone could read it. Close skips to the next one.
     */
    private notify(key: string, params?: object): void {
        const message = this.translate.instant(key, params);
        const action = this.translate.instant('CLOSE');
        this.popups = this.popups.then(
            () =>
                new Promise<void>((resolve) => {
                    this.snackBar
                        .open(message, action, { duration: POPUP_MS })
                        .afterDismissed()
                        .subscribe(() => resolve());
                })
        );
    }
}

function sourceRoute(playlist: Playlist): string[] {
    if (playlist.serverUrl) {
        return ['/workspace', 'xtreams', playlist._id];
    }
    if (playlist.macAddress) {
        return ['/workspace', 'stalker', playlist._id];
    }
    return ['/workspace', 'playlists', playlist._id];
}

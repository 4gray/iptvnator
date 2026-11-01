import {
    DestroyRef,
    inject,
    Injector,
    Signal,
    WritableSignal,
} from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    createXtreamConnectionTestState,
    DatabaseService,
    PlaylistsService,
    PlaylistStorageBackend,
    RuntimeCapabilitiesService,
    SourceActivityService,
} from '@iptvnator/services';
import { XtreamSelectedCatalogRefreshService } from '@iptvnator/services/xtream-catalog-refresh';
import {
    getXtreamContentRoute,
    newlyEnabledXtreamTypes,
    normalizeXtreamContentTypes,
    Playlist,
    PlaylistMeta,
    PlaylistMetaUpdate,
} from '@iptvnator/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import { PlaylistEpgSourceEditor } from './playlist-epg-source-editor';
import {
    hasStalkerConnectionChanged,
    normalizePlaylistConnectionMeta,
    omitStalkerConnection,
} from './stalker-playlist-edit.utils';
import {
    STALKER_PLAYLIST_CONNECTION_EDITOR,
    STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS,
} from './stalker-playlist-connection-editor.token';

interface PlaylistInfoSaveHost {
    playlist: Playlist & { id: string };
    playlistDetails: UntypedFormGroup;
    readonly isSaving: WritableSignal<boolean>;
    readonly isRefreshingSelectedCatalogs: WritableSignal<boolean>;
    readonly isHydratingStalkerPlaylist: Signal<boolean>;
    readonly stalkerPlaylistHydrationFailed: Signal<boolean>;
    readonly connectionTest: ReturnType<typeof createXtreamConnectionTestState>;
    readonly epg: PlaylistEpgSourceEditor;
    updateXtreamPlaylist(
        playlist: PlaylistMeta,
        persistShared?: () => Promise<PlaylistMeta>
    ): Promise<PlaylistMeta>;
}

/** Dialog-scoped persistence; the host retains the current form and view state. */
export class PlaylistInfoSaver {
    private readonly playlistsService = inject(PlaylistsService);
    private readonly playlistStorage = inject(PlaylistStorageBackend);
    private readonly databaseService = inject(DatabaseService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly store = inject(Store);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);
    private readonly stalkerConnectionEditor = inject(
        STALKER_PLAYLIST_CONNECTION_EDITOR
    );
    private readonly dialogRef = inject(MatDialogRef, { optional: true });

    constructor(
        private readonly host: PlaylistInfoSaveHost,
        private readonly hydration: () => Promise<void>,
        private readonly isClosing: () => boolean
    ) {}

    async saveChanges(playlist: PlaylistMeta): Promise<void> {
        if (this.host.isSaving() || this.host.connectionTest.testing()) {
            return;
        }

        this.host.isSaving.set(true);
        if (this.dialogRef) {
            this.dialogRef.disableClose = true;
        }
        try {
            if (this.host.epg.hasPendingRemovals)
                await this.host.epg.waitForRemovals();
            let submittedPlaylist = playlist;
            if (this.host.isHydratingStalkerPlaylist()) {
                await this.hydration();
                submittedPlaylist = this.host.playlistDetails
                    .value as PlaylistMeta;
            }
            if (
                this.host.stalkerPlaylistHydrationFailed() ||
                this.host.playlistDetails.invalid
            ) {
                return;
            }

            let resolvedStalkerConnection = false;
            let resolvedStalkerSessionPatch:
                PlaylistMetaUpdate['stalkerSessionPatch'] | undefined;
            let preserveCurrentMetadata = false;
            let normalizedPlaylist: PlaylistMetaUpdate =
                normalizePlaylistConnectionMeta(
                    this.host.epg.prepareSave(submittedPlaylist),
                    this.host.playlist
                );
            const sharedSource = this.playlistStorage.kind() === 'server';
            if (sharedSource)
                normalizedPlaylist = {
                    ...normalizedPlaylist,
                    sourceSyncBase: this.host.playlist.sourceSyncBase,
                    sourceSyncRevision: this.host.playlist.sourceSyncRevision,
                };
            if (this.host.playlist.portalUrl) {
                if (
                    hasStalkerConnectionChanged(
                        this.host.playlist,
                        normalizedPlaylist
                    )
                ) {
                    const result =
                        await this.stalkerConnectionEditor.resolveConnection(
                            normalizedPlaylist,
                            this.host.playlist
                        );
                    if (
                        result.status !==
                        STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.RESOLVED
                    ) {
                        this.snackBar.open(
                            result.message,
                            this.translate.instant('CLOSE'),
                            { duration: 8000 }
                        );
                        return;
                    }
                    normalizedPlaylist = result.playlist;
                    resolvedStalkerSessionPatch =
                        result.playlist.stalkerSessionPatch;
                    resolvedStalkerConnection = true;
                    preserveCurrentMetadata =
                        this.isClosing() || this.destroyRef.destroyed;
                } else {
                    normalizedPlaylist =
                        omitStalkerConnection(normalizedPlaylist);
                }
            }
            const isXtream =
                !this.host.playlist.portalUrl &&
                this.host.playlist.username &&
                this.host.playlist.password &&
                this.host.playlist.serverUrl;

            let sharedXtreamPersisted = false;
            if (isXtream && this.runtime.supportsXtreamSqliteDataSource) {
                normalizedPlaylist = await this.host.updateXtreamPlaylist(
                    normalizedPlaylist,
                    sharedSource
                        ? async () => {
                              const saved = await firstValueFrom(
                                  this.playlistsService.updatePlaylistMeta(
                                      normalizedPlaylist
                                  )
                              );
                              sharedXtreamPersisted = true;
                              return saved;
                          }
                        : undefined
                );
            }

            if (resolvedStalkerConnection) {
                normalizedPlaylist = preserveCurrentMetadata
                    ? await this.stalkerConnectionEditor.applyResolvedConnection(
                          normalizedPlaylist,
                          { preserveCurrentMetadata: true }
                      )
                    : await this.stalkerConnectionEditor.applyResolvedConnection(
                          normalizedPlaylist
                      );
                normalizedPlaylist = {
                    ...normalizedPlaylist,
                    stalkerSessionPatch: resolvedStalkerSessionPatch,
                };
            }

            if (sharedSource && !sharedXtreamPersisted) {
                normalizedPlaylist = await firstValueFrom(
                    resolvedStalkerConnection
                        ? this.playlistsService.getPlaylistById(
                              this.host.playlist._id
                          )
                        : this.playlistsService.updatePlaylistMeta(
                              normalizedPlaylist
                          )
                );
            }

            // Awaited owners publish accepted state without another write.
            // The metadata effect still reconciles saved EPG source changes.
            this.store.dispatch(
                PlaylistActions.updatePlaylistMeta({
                    playlist: normalizedPlaylist,
                    ...(resolvedStalkerConnection || sharedSource
                        ? { persist: false }
                        : {}),
                })
            );

            // Save already authorized this connection change, and a full
            // portal's completed get_profile may have pinned the submitted
            // serial/device identity remotely. Navigation cannot recall that
            // request, so the resolved identity/session is persisted above
            // even when the dialog disappears. Only view-side completion is
            // suppressed after destruction/close animation begins.
            if (this.isClosing() || this.destroyRef.destroyed) {
                return;
            }

            this.snackBar.open(
                this.translate.instant(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'
                ),
                this.translate.instant('CLOSE'),
                { duration: 3000 }
            );
            this.dialogRef?.close();
            const target =
                isXtream && this.runtime.supportsXtreamSqliteDataSource
                    ? getXtreamContentRoute(
                          newlyEnabledXtreamTypes(
                              this.host.playlist.xtreamContentTypes,
                              normalizedPlaylist.xtreamContentTypes
                          )
                      )
                    : null;
            if (target) {
                await this.injector
                    .get(Router)
                    .navigate([
                        '/workspace',
                        'xtreams',
                        this.host.playlist._id,
                        target,
                    ]);
            }
        } catch (error) {
            console.error('Error updating playlist:', error);
            const sourceError =
                error instanceof Error
                    ? error.message.match(/SOURCE_SYNC\.[A-Z_]+/)?.[0]
                    : undefined;
            this.snackBar.open(
                this.translate.instant(
                    sourceError ?? 'HOME.PLAYLISTS.PLAYLIST_UPDATE_FAILED'
                ),
                this.translate.instant('CLOSE'),
                {
                    duration: 3000,
                }
            );
        } finally {
            if (this.dialogRef) {
                this.dialogRef.disableClose = false;
            }
            this.host.isRefreshingSelectedCatalogs.set(false);
            this.host.isSaving.set(false);
        }
    }

    async updateXtreamPlaylist(
        playlist: PlaylistMeta,
        persistShared?: () => Promise<PlaylistMeta>
    ): Promise<PlaylistMeta> {
        if (
            this.injector
                .get(SourceActivityService)
                .isBusy(this.host.playlist._id)
        ) {
            throw new Error(
                'Wait for the source import or refresh to finish before editing it.'
            );
        }
        const newlyEnabled = newlyEnabledXtreamTypes(
            this.host.playlist.xtreamContentTypes,
            playlist.xtreamContentTypes
        );
        const persist =
            persistShared ??
            (async () => {
                const saved =
                    await this.databaseService.updateXtreamPlaylistDetails({
                        id: this.host.playlist._id,
                        title: playlist.title,
                        username: playlist.username,
                        password: playlist.password,
                        userAgent: playlist.userAgent ?? '',
                        serverUrl: playlist.serverUrl,
                        xtreamContentTypes: playlist.xtreamContentTypes,
                    });
                if (!saved)
                    throw new Error('Failed to update playlist in database');
                return playlist;
            });
        let savedMetadata: PlaylistMeta | undefined;
        const persistOnce = async () => (savedMetadata ??= await persist());

        if (newlyEnabled.length) {
            this.host.isRefreshingSelectedCatalogs.set(true);
            try {
                await this.injector
                    .get(XtreamSelectedCatalogRefreshService)
                    .refresh(playlist, newlyEnabled, async () => {
                        return persistOnce();
                    });
            } catch (error) {
                // Accepted metadata stays authoritative after a cache failure.
                // A parked snapshot keeps its selected types for retry imports.
                if (savedMetadata) {
                    let saved: PlaylistMeta | null = savedMetadata;
                    if (persistShared) {
                        try {
                            saved = await firstValueFrom(
                                this.playlistsService.getPlaylistById(
                                    this.host.playlist._id
                                )
                            );
                        } catch {
                            // A failed read cannot authorize rolling back a
                            // newer shared projection. Preserve the scan error.
                            saved = null;
                        }
                        if (saved) {
                            // Metadata was already accepted. Rebase the form
                            // too, including when a storage error hid a late
                            // connection change; a second Save must not revert it.
                            this.host.playlist = {
                                ...this.host.playlist,
                                ...saved,
                                userAgent: saved.userAgent,
                                referrer: saved.referrer,
                                origin: saved.origin,
                                xtreamContentTypes: saved.xtreamContentTypes,
                            };
                            this.host.playlistDetails.patchValue({
                                ...saved,
                                userAgent: saved.userAgent ?? '',
                                xtreamContentTypes: normalizeXtreamContentTypes(
                                    saved.xtreamContentTypes
                                ),
                            });
                            this.host.playlistDetails.markAsPristine();
                        }
                    }
                    if (saved)
                        this.store.dispatch(
                            PlaylistActions.updatePlaylistMeta({
                                playlist: saved,
                                ...(persistShared ? { persist: false } : {}),
                            })
                        );
                }
                throw error;
            }
        }
        // The metadata action below updates PlaylistContextFacade; the routed
        // Xtream session observes connection changes and bootstraps fresh state.
        return persistOnce();
    }
}

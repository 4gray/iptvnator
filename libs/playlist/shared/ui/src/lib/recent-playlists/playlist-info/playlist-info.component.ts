import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import {
    Component,
    DestroyRef,
    inject,
    runInInjectionContext,
    signal,
    ChangeDetectionStrategy,
} from '@angular/core';
import {
    FormControl,
    ReactiveFormsModule,
    UntypedFormArray,
    UntypedFormBuilder,
    UntypedFormGroup,
} from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { firstValueFrom } from 'rxjs';
import {
    createXtreamConnectionTestState,
    DatabaseService,
    PlaylistsService,
    PlaylistStorageBackend,
    RuntimeCapabilitiesService,
    XtreamSelectedCatalogRefreshService,
    SourceActivityService,
    XtreamPendingRestoreService,
} from '@iptvnator/services';
import {
    normalizeStalkerIdentityValue,
    normalizeStalkerMacAddress,
    normalizeXtreamContentTypes,
    newlyEnabledXtreamTypes,
    getXtreamContentRoute,
    Playlist,
    PlaylistMeta,
    PlaylistMetaUpdate,
} from '@iptvnator/shared/interfaces';
import { PasswordVisibilityToggleDirective } from '@iptvnator/ui/components/password-visibility-toggle';
import {
    hasStalkerConnectionChanged,
    omitStalkerConnection,
    normalizePlaylistConnectionMeta,
} from './stalker-playlist-edit.utils';
import {
    STALKER_PLAYLIST_CONNECTION_EDITOR,
    STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS,
} from './stalker-playlist-connection-editor.token';
import { RevealDetailsDirective } from '@iptvnator/ui/components/reveal-details';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import {
    DialogFooterDirective,
    DialogFooterStartDirective,
    DialogShellComponent,
    XtreamContentSelectionComponent,
} from '@iptvnator/ui/components';

import { createPlaylistDetailsForm } from './playlist-info-form';
import { PlaylistEpgSourceEditor } from './playlist-epg-source-editor';
import { PlaylistInfoFileActions } from './playlist-info-file-actions';
import { XtreamSelectionProgressComponent } from '../../xtream-selection-progress.component';

@Component({
    selector: 'app-playlist-info',
    templateUrl: './playlist-info.component.html',
    styleUrl: './playlist-info.component.scss',
    providers: [provideFormFieldDefaults(), DatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        RevealDetailsDirective,
        NgTemplateOutlet,
        DialogFooterDirective,
        DialogFooterStartDirective,
        DialogShellComponent,
        XtreamContentSelectionComponent,
        XtreamSelectionProgressComponent,
        MatButton,
        MatCheckboxModule,
        MatDialogModule,
        MatIcon,
        MatIconButton,
        MatInputModule,
        MatTooltip,
        PasswordVisibilityToggleDirective,
        ReactiveFormsModule,
        TranslatePipe,
    ],
})
export class PlaylistInfoComponent {
    private datePipe = inject(DatePipe);
    private formBuilder = inject(UntypedFormBuilder);
    private playlistsService = inject(PlaylistsService);
    private readonly playlistStorage = inject(PlaylistStorageBackend);
    private store = inject(Store);
    private databaseService = inject(DatabaseService);
    private snackBar = inject(MatSnackBar);
    private translate = inject(TranslateService);
    private runtime = inject(RuntimeCapabilitiesService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly stalkerConnectionEditor = inject(
        STALKER_PLAYLIST_CONNECTION_EDITOR
    );
    private dialogRef = inject(MatDialogRef<PlaylistInfoComponent>, {
        optional: true,
    });
    public playlistData = inject<Playlist & { id: string }>(MAT_DIALOG_DATA);
    readonly isSaving = signal(false);
    readonly isRefreshingSelectedCatalogs = signal(false);
    readonly isHydratingStalkerPlaylist = signal(false);
    readonly stalkerPlaylistHydrationFailed = signal(false);
    private dialogClosing = false;
    private readonly stalkerPlaylistHydration: Promise<void>;

    get supportsXtreamSelection(): boolean {
        return this.runtime.supportsXtreamSqliteDataSource;
    }

    get isDesktop(): boolean {
        return this.runtime.supportsDesktopFileSave;
    }

    /**
     * True once a device ID has actually reached the portal, which is the
     * point of no return: the stock server pins the first non-empty
     * `device_id`/`device_id2` to the MAC permanently, refuses a different one
     * as a device conflict, and treats a later empty value as a lockout. The
     * fields stay editable — a value that was never accepted may well need
     * correcting — but the consequence has to be on screen.
     *
     * Storage is not transmission, so `isFullStalkerPortal` gates it.
     * `device_id` travels only on `get_profile`/`do_auth`, which simple
     * panel-style portals never run; the import's offline fallback also
     * persists whatever was typed and records the playlist as simple. Warning
     * those users that a change "will lock this source out" would be false,
     * and would discourage them from fixing an ID that was never pinned.
     */
    get hasStoredStalkerDeviceIds(): boolean {
        if (!this.playlist.isFullStalkerPortal) {
            return false;
        }

        return Boolean(
            normalizeStalkerIdentityValue(this.playlist.stalkerDeviceId1) ??
            normalizeStalkerIdentityValue(this.playlist.stalkerDeviceId2)
        );
    }

    /**
     * Canonicalizes an edited MAC on blur, so the stored value is the one the
     * portal's own format check accepts.
     *
     * Only an EDIT normalizes it. Merely focusing the field and tabbing on
     * must leave it alone: rewriting it there would mark the form dirty and
     * make the value differ from the stored one, which is exactly what the
     * submit-path guard reads — so a later title-only save would carry the
     * rewritten identity through and move the session fingerprint without the
     * user having touched the MAC at all.
     */
    onMacAddressBlur(): void {
        const control = this.playlistDetails.get('macAddress');

        if (!control || control.value === this.playlist.macAddress) {
            return;
        }

        const normalized = normalizeStalkerMacAddress(control.value);

        if (normalized && normalized !== control.value) {
            control.setValue(normalized);
            control.markAsDirty();
        }
    }

    /**
     * Playlist object. Signal-backed because it is replaced after awaited
     * hydration and EPG source edits, which no template event marks for an
     * OnPush check.
     */
    private readonly playlistState = signal<Playlist & { id: string }>(
        this.playlistData
    );
    get playlist(): Playlist & { id: string } {
        return this.playlistState();
    }
    set playlist(value: Playlist & { id: string }) {
        this.playlistState.set(value);
    }

    /** Form group with playlist details */
    playlistDetails!: UntypedFormGroup;
    readonly epg = new PlaylistEpgSourceEditor(
        () => this.playlist,
        (playlist) => {
            this.playlist = playlist;
        },
        () =>
            this.playlistDetails.get(
                'playlistEpgSourceInputs'
            ) as UntypedFormArray,
        () => this.isSaving()
    );
    private readonly fileActions = new PlaylistInfoFileActions(
        () => this.playlist,
        () => this.playlistDetails.get('url')?.value
    );
    private readonly injector = inject(Injector);
    connectionTest: ReturnType<typeof createXtreamConnectionTestState>;

    constructor() {
        this.dialogRef?.beforeClosed().subscribe(() => {
            this.dialogClosing = true;
        });
        this.createForm();
        this.connectionTest = createXtreamConnectionTestState(
            this.playlistDetails
        );
        if (
            this.playlist.portalUrl ||
            this.playlistStorage.kind() === 'server'
        ) {
            this.isHydratingStalkerPlaylist.set(true);
            this.stalkerPlaylistHydration =
                this.hydrateCompleteStalkerPlaylist();
        } else {
            this.stalkerPlaylistHydration = Promise.resolve();
        }
    }

    /**
     * Create the form and set initial data on component init
     */
    createForm(): void {
        this.playlistDetails = createPlaylistDetailsForm(
            this.playlist,
            this.formBuilder,
            this.datePipe
        );
        this.playlistDetails.addControl(
            'xtreamContentTypes',
            new FormControl(
                normalizeXtreamContentTypes(this.playlist.xtreamContentTypes)
            )
        );
    }

    get hasAdvancedStalkerOptions(): boolean {
        return [
            'stalkerSerialNumber',
            'stalkerDeviceId1',
            'stalkerDeviceId2',
            'stalkerSignature1',
            'stalkerSignature2',
            'username',
            'password',
        ].some(
            (key) =>
                Boolean(this.playlistDetails.get(key)?.value) ||
                this.playlistDetails.get(key)?.invalid
        );
    }

    async saveChanges(playlist: PlaylistMeta): Promise<void> {
        if (this.isSaving() || this.connectionTest.testing()) {
            return;
        }

        this.isSaving.set(true);
        if (this.dialogRef) {
            this.dialogRef.disableClose = true;
        }
        try {
            if (this.epg.hasPendingRemovals) await this.epg.waitForRemovals();
            let submittedPlaylist = playlist;
            if (this.isHydratingStalkerPlaylist()) {
                await this.stalkerPlaylistHydration;
                submittedPlaylist = this.playlistDetails.value as PlaylistMeta;
            }
            if (
                this.stalkerPlaylistHydrationFailed() ||
                this.playlistDetails.invalid
            ) {
                return;
            }

            let resolvedStalkerConnection = false;
            let resolvedStalkerSessionPatch:
                PlaylistMetaUpdate['stalkerSessionPatch'] | undefined;
            let preserveCurrentMetadata = false;
            let normalizedPlaylist: PlaylistMetaUpdate =
                normalizePlaylistConnectionMeta(
                    this.epg.prepareSave(submittedPlaylist),
                    this.playlist
                );
            const sharedSource = this.playlistStorage.kind() === 'server';
            if (sharedSource)
                normalizedPlaylist = {
                    ...normalizedPlaylist,
                    sourceSyncBase: this.playlist.sourceSyncBase,
                    sourceSyncRevision: this.playlist.sourceSyncRevision,
                };
            if (this.playlist.portalUrl) {
                if (
                    hasStalkerConnectionChanged(
                        this.playlist,
                        normalizedPlaylist
                    )
                ) {
                    const result =
                        await this.stalkerConnectionEditor.resolveConnection(
                            normalizedPlaylist,
                            this.playlist
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
                        this.dialogClosing || this.destroyRef.destroyed;
                } else {
                    normalizedPlaylist =
                        omitStalkerConnection(normalizedPlaylist);
                }
            }
            const isXtream =
                !this.playlist.portalUrl &&
                this.playlist.username &&
                this.playlist.password &&
                this.playlist.serverUrl;

            if (
                isXtream &&
                this.runtime.supportsXtreamSqliteDataSource &&
                !sharedSource
            ) {
                await this.updateXtreamPlaylist(normalizedPlaylist);
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

            if (sharedSource) {
                normalizedPlaylist = await firstValueFrom(
                    resolvedStalkerConnection
                        ? this.playlistsService.getPlaylistById(
                              this.playlist._id
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
            if (this.dialogClosing || this.destroyRef.destroyed) {
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
                              this.playlist.xtreamContentTypes,
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
                        this.playlist._id,
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
            this.isRefreshingSelectedCatalogs.set(false);
            this.isSaving.set(false);
        }
    }

    /**
     * Electron's startup metadata projection deliberately excludes the
     * payload-only Stalker identity and source revision fields. Editing that summary
     * directly would render the identity controls empty and could clear a
     * portal-pinned serial/device identity on the next discovery. Hydrate the
     * authoritative row before enabling the form in every runtime so Edit
     * always starts from the same persisted connection that playback uses.
     * Shared editors also capture the complete source baseline and revision here,
     * while inventory reads remain payload-free.
     */
    private async hydrateCompleteStalkerPlaylist(): Promise<void> {
        try {
            const persistedPlaylist = await firstValueFrom(
                this.playlistsService.getPlaylistById(this.playlist._id)
            );
            if (!persistedPlaylist) {
                throw new Error('Stored Stalker playlist was not found');
            }

            this.playlist = {
                ...this.playlistData,
                ...persistedPlaylist,
                id: this.playlistData.id ?? persistedPlaylist._id,
            };
            this.createForm();
            this.connectionTest = runInInjectionContext(this.injector, () =>
                createXtreamConnectionTestState(this.playlistDetails)
            );
        } catch (error) {
            console.error('Failed to load complete Stalker playlist:', error);
            this.stalkerPlaylistHydrationFailed.set(true);
            this.snackBar.open(
                this.translate.instant('HOME.PLAYLISTS.PLAYLIST_UPDATE_FAILED'),
                this.translate.instant('CLOSE'),
                { duration: 3000 }
            );
        } finally {
            this.isHydratingStalkerPlaylist.set(false);
        }
    }

    async updateXtreamPlaylist(playlist: PlaylistMeta) {
        if (
            this.injector.get(SourceActivityService).isBusy(this.playlist._id)
        ) {
            throw new Error(
                'Wait for the source import or refresh to finish before editing it.'
            );
        }
        const newlyEnabled = newlyEnabledXtreamTypes(
            this.playlist.xtreamContentTypes,
            playlist.xtreamContentTypes
        );
        const persist = () =>
            this.databaseService.updateXtreamPlaylistDetails({
                id: this.playlist._id,
                title: playlist.title,
                username: playlist.username,
                password: playlist.password,
                serverUrl: playlist.serverUrl,
                xtreamContentTypes: playlist.xtreamContentTypes,
            });

        if (newlyEnabled.length) {
            this.isRefreshingSelectedCatalogs.set(true);
            try {
                await this.injector
                    .get(XtreamSelectedCatalogRefreshService)
                    .refresh(playlist, newlyEnabled);
            } catch (error) {
                // A parked snapshot may follow a partial replacement. Keep its types
                // enabled so retry imports them before consuming their saved history.
                if (
                    this.injector
                        .get(XtreamPendingRestoreService)
                        .getOrThrow(this.playlist._id)
                ) {
                    if (!(await persist()))
                        throw new Error(
                            'Failed to persist catalog recovery selection.'
                        );
                    this.store.dispatch(
                        PlaylistActions.updatePlaylistMeta({ playlist })
                    );
                }
                throw error;
            }
        }
        if (!(await persist()))
            throw new Error('Failed to update playlist in database');

        // The metadata action below updates PlaylistContextFacade; the routed
        // Xtream session observes connection changes and bootstraps fresh state.
    }

    exportPlaylist(): Promise<void> {
        return this.fileActions.exportPlaylist();
    }

    copyUrl(): void {
        this.fileActions.copyUrl();
    }
}

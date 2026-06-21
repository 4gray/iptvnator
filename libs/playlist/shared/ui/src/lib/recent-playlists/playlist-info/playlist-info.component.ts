import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import {
    FormControl,
    ReactiveFormsModule,
    UntypedFormArray,
    UntypedFormBuilder,
    UntypedFormGroup,
    Validators,
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
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { firstValueFrom } from 'rxjs';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    normalizeXtreamServerUrl,
    Playlist,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import {
    normalizeEpgUrls,
    resolvePlaylistEpgSourceState,
} from '@iptvnator/shared/m3u-utils';

type DesktopFileSaveBridge = Pick<
    typeof window.electron,
    'saveFileDialog' | 'writeFile'
>;

const EPG_URL_PATTERN = /^\s*(http|https|file):\/\/[^ "]+\s*$/;

@Component({
    selector: 'app-playlist-info',
    templateUrl: './playlist-info.component.html',
    styles: [
        `
            .spacer {
                flex: 1 1 auto;
            }

            mat-dialog-content {
                display: flex;
                flex-direction: column;
                gap: 14px;
            }

            // Material's '.mat-mdc-dialog-title + .mat-mdc-dialog-content' rule
            // zeroes padding-top with higher specificity than a scoped override,
            // which clips the first field's floating label. Pushing the first
            // field down with margin-top side-steps that entirely.
            mat-dialog-content > mat-form-field:first-child {
                margin-top: 10px;
            }

            mat-dialog-content mat-checkbox {
                margin-top: 4px;
            }

            mat-dialog-content p {
                margin: 0;
                color: var(--mat-sys-on-surface-variant);
                font-size: 12.5px;
                line-height: 1.45;
            }

            .playlist-epg-sources {
                display: flex;
                flex-direction: column;
                gap: 10px;
                padding: 12px;
                border: 1px solid
                    var(
                        --app-widget-header-border,
                        var(--mat-sys-outline-variant)
                    );
                border-radius: 8px;
                background: var(--mat-sys-surface-container-low);
            }

            .playlist-epg-sources__header {
                display: flex;
                gap: 10px;
                align-items: flex-start;
            }

            .playlist-epg-sources__header mat-icon {
                color: var(--mat-sys-primary);
            }

            .playlist-epg-sources__title {
                margin: 0 0 2px;
                font-size: 14px;
                font-weight: 600;
                line-height: 1.25;
            }

            .playlist-epg-source-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto auto auto;
                gap: 6px;
                align-items: center;
            }

            .playlist-epg-source-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                justify-content: flex-end;
            }

            @media (max-width: 520px) {
                .playlist-epg-source-row {
                    grid-template-columns: minmax(0, 1fr);
                }
            }
        `,
    ],
    providers: [DatePipe],
    imports: [
        ClipboardModule,
        MatButton,
        MatCheckboxModule,
        MatDialogModule,
        MatIcon,
        MatIconButton,
        MatInputModule,
        MatTooltip,
        ReactiveFormsModule,
        TranslatePipe,
    ],
})
export class PlaylistInfoComponent {
    private clipboard = inject(Clipboard);
    private datePipe = inject(DatePipe);
    private formBuilder = inject(UntypedFormBuilder);
    private playlistsService = inject(PlaylistsService);
    private store = inject(Store);
    private databaseService = inject(DatabaseService);
    private snackBar = inject(MatSnackBar);
    private translate = inject(TranslateService);
    private runtime = inject(RuntimeCapabilitiesService);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly settingsStore = inject(SettingsStore);
    private dialogRef = inject(MatDialogRef<PlaylistInfoComponent>, {
        optional: true,
    });
    public playlistData = inject<Playlist & { id: string }>(MAT_DIALOG_DATA);

    get isDesktop(): boolean {
        return this.runtime.supportsDesktopFileSave;
    }

    get playlistEpgUrls(): string[] {
        return this.normalizeEpgUrls(this.playlist.epgUrls);
    }

    get playlistDetectedEpgUrls(): string[] {
        const detectedUrls = this.normalizeEpgUrls(
            this.playlist.detectedEpgUrls
        );
        return detectedUrls.length > 0 ? detectedUrls : this.playlistEpgUrls;
    }

    get hiddenDetectedPlaylistEpgSourceCount(): number {
        const enabledUrls = new Set(this.playlistEpgUrls);
        return this.playlistDetectedEpgUrls.filter(
            (url) => !enabledUrls.has(url)
        ).length;
    }

    get canRefreshPlaylistEpg(): boolean {
        return this.epgBridge.supportsDataManagement;
    }

    get canManagePlaylistEpgSources(): boolean {
        return !this.playlist.serverUrl && !this.playlist.macAddress;
    }

    get playlistEpgSourceInputs(): UntypedFormArray {
        return this.playlistDetails.get(
            'playlistEpgSourceInputs'
        ) as UntypedFormArray;
    }

    /** Playlist object */
    playlist: Playlist & { id: string };

    /** Form group with playlist details */
    playlistDetails!: UntypedFormGroup;

    constructor() {
        this.playlist = this.playlistData;
        this.createForm();
    }

    /**
     * Create the form and set initial data on component init
     */
    createForm(): void {
        this.playlistDetails = this.formBuilder.group({
            _id: this.playlist._id,
            title: new FormControl(this.playlist.title, Validators.required),
            userAgent: this.playlist.userAgent || '',
            filename: new FormControl({
                value: this.playlist.filename || '',
                disabled: true,
            }),
            count: new FormControl({
                value: this.playlist.count,
                disabled: true,
            }),
            importDate: new FormControl({
                value: this.datePipe.transform(this.playlist.importDate),
                disabled: true,
            }),
            url: new FormControl({
                value: this.playlist.url,
                disabled: true,
            }),
            filePath: new FormControl({
                value: this.playlist.filePath,
                disabled: true,
            }),
            autoRefresh: new FormControl(this.playlist.autoRefresh),
            serverUrl: new FormControl(this.playlist.serverUrl),
            username: new FormControl(this.playlist.username),
            password: new FormControl(this.playlist.password),
            macAddress: new FormControl(this.playlist.macAddress),
            portalUrl: new FormControl(this.playlist.portalUrl),
            stalkerSerialNumber: new FormControl(
                this.playlist.stalkerSerialNumber
            ),
            stalkerDeviceId1: new FormControl(this.playlist.stalkerDeviceId1),
            stalkerDeviceId2: new FormControl(this.playlist.stalkerDeviceId2),
            stalkerSignature1: new FormControl(this.playlist.stalkerSignature1),
            stalkerSignature2: new FormControl(this.playlist.stalkerSignature2),
            playlistEpgSourceInputs: new UntypedFormArray([
                this.createPlaylistEpgSourceControl(),
            ]),
        });
    }

    async saveChanges(playlist: PlaylistMeta): Promise<void> {
        try {
            const normalizedPlaylist =
                this.normalizeXtreamPlaylistMeta(playlist);
            const isXtream =
                this.playlist &&
                this.playlist.username &&
                this.playlist.password &&
                this.playlist.serverUrl;

            if (isXtream && this.runtime.supportsXtreamSqliteDataSource) {
                await this.updateXtreamPlaylist(normalizedPlaylist);
            }

            // Dispatch store action to update UI
            this.store.dispatch(
                PlaylistActions.updatePlaylistMeta({
                    playlist: normalizedPlaylist,
                })
            );

            this.snackBar.open(
                this.translate.instant(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'
                ),
                this.translate.instant('CLOSE'),
                { duration: 3000 }
            );
            this.dialogRef?.close();
        } catch (error) {
            console.error('Error updating playlist:', error);
            this.snackBar.open(
                this.translate.instant('HOME.PLAYLISTS.PLAYLIST_UPDATE_FAILED'),
                this.translate.instant('CLOSE'),
                {
                    duration: 3000,
                }
            );
        }
    }

    private normalizeXtreamPlaylistMeta(playlist: PlaylistMeta): PlaylistMeta {
        if (!playlist.serverUrl || !playlist.username || !playlist.password) {
            return playlist;
        }

        return {
            ...playlist,
            password: playlist.password.trim(),
            serverUrl: normalizeXtreamServerUrl(playlist.serverUrl),
            username: playlist.username.trim(),
        };
    }

    async updateXtreamPlaylist(playlist: PlaylistMeta) {
        const success = await this.databaseService.updateXtreamPlaylistDetails({
            id: this.playlist._id,
            title: playlist.title,
            username: playlist.username,
            password: playlist.password,
            serverUrl: playlist.serverUrl,
        });

        if (!success) {
            throw new Error('Failed to update playlist in database');
        }

        // TODO: circular dependency
        /* this.xtreamStore.updatePlaylist({
            name: playlist.title,
            username: playlist.username,
            password: playlist.password,
            serverUrl: playlist.serverUrl,
        }); */
    }

    async refreshPlaylistEpgSource(url: string): Promise<void> {
        const normalizedUrl = url.trim();
        if (!normalizedUrl) {
            return;
        }

        const result = await this.epgBridge.forceFetchEpg(
            normalizedUrl,
            this.settingsStore.getTrustOptions()
        );

        if (!result) {
            return;
        }

        this.snackBar.open(
            this.translate.instant(
                result.success ? 'EPG.FETCH_SUCCESS' : 'EPG.ERROR'
            ),
            this.translate.instant('CLOSE'),
            { duration: 3000 }
        );
    }

    async addPlaylistEpgSourceToSettings(url: string): Promise<void> {
        const epgUrl = url.trim();
        if (!epgUrl || this.isGlobalEpgSource(epgUrl)) {
            return;
        }

        const currentSettings = this.settingsStore.getSettings();
        await this.settingsStore.updateSettings({
            epgUrl: this.normalizeEpgUrls([
                ...(currentSettings.epgUrl ?? []),
                epgUrl,
            ]),
        });

        this.snackBar.open(
            this.translate.instant('SETTINGS.ADD_EPG_SOURCE'),
            this.translate.instant('CLOSE'),
            { duration: 3000 }
        );
    }

    isGlobalEpgSource(url: string): boolean {
        const normalizedUrl = url.trim();
        if (!normalizedUrl) {
            return false;
        }

        return this.normalizeEpgUrls(
            this.settingsStore.getSettings().epgUrl
        ).includes(normalizedUrl);
    }

    async removePlaylistEpgSource(url: string): Promise<void> {
        const epgUrl = url.trim();
        if (!epgUrl) {
            return;
        }

        if (this.epgBridge.supportsDataManagement) {
            try {
                const result =
                    await this.epgBridge.clearEpgDataForSource(epgUrl);
                if (result && result.success === false) {
                    throw new Error('Clear EPG source returned false');
                }
            } catch (error) {
                console.error(
                    'Failed to clear playlist EPG source data:',
                    error
                );
                this.snackBar.open(
                    this.translate.instant('SETTINGS.EPG_DATA_CLEAR_FAILED'),
                    this.translate.instant('CLOSE'),
                    { duration: 3000 }
                );
                return;
            }
        }

        const detectedEpgUrls = this.getRawDetectedPlaylistEpgUrls();
        const disabledEpgUrls = this.normalizeEpgUrls(
            this.playlist.disabledEpgUrls
        );
        const nextDisabledEpgUrls = detectedEpgUrls.includes(epgUrl)
            ? this.normalizeEpgUrls([...disabledEpgUrls, epgUrl])
            : disabledEpgUrls.filter((disabledUrl) => disabledUrl !== epgUrl);

        const state = resolvePlaylistEpgSourceState({
            detectedEpgUrls,
            enabledEpgUrls: this.playlistEpgUrls.filter(
                (enabledUrl) => enabledUrl !== epgUrl
            ),
            manualEpgUrls: this.normalizeEpgUrls(
                this.playlist.manualEpgUrls
            ).filter((manualUrl) => manualUrl !== epgUrl),
            disabledEpgUrls: nextDisabledEpgUrls,
        });

        this.applyPlaylistEpgSourceState(state);
    }

    addPlaylistEpgSourceInput(): void {
        this.playlistEpgSourceInputs.push(
            this.createPlaylistEpgSourceControl()
        );
    }

    removePlaylistEpgSourceInput(index: number): void {
        if (this.playlistEpgSourceInputs.length <= 1) {
            this.playlistEpgSourceInputs.at(0).reset('');
            return;
        }

        this.playlistEpgSourceInputs.removeAt(index);
    }

    savePlaylistEpgSources(): void {
        if (this.playlistEpgSourceInputs.invalid) {
            this.playlistEpgSourceInputs.markAllAsTouched();
            return;
        }

        const addedUrls = this.normalizeEpgUrls(
            this.playlistEpgSourceInputs.value as string[]
        );
        if (addedUrls.length === 0) {
            return;
        }

        const addedUrlSet = new Set(addedUrls);
        const state = resolvePlaylistEpgSourceState({
            detectedEpgUrls: this.getRawDetectedPlaylistEpgUrls(),
            enabledEpgUrls: this.normalizeEpgUrls([
                ...this.playlistEpgUrls,
                ...addedUrls,
            ]),
            manualEpgUrls: this.normalizeEpgUrls([
                ...(this.playlist.manualEpgUrls ?? []),
                ...addedUrls,
            ]),
            disabledEpgUrls: this.normalizeEpgUrls(
                this.playlist.disabledEpgUrls
            ).filter((url) => !addedUrlSet.has(url)),
        });

        this.applyPlaylistEpgSourceState(state);
        this.resetPlaylistEpgSourceInputs();
    }

    async exportPlaylist() {
        const playlistAsString = await firstValueFrom(
            this.playlistsService.getRawPlaylistById(this.playlist._id)
        );

        if (this.runtime.supportsDesktopFileSave) {
            const desktopFileBridge = window.electron as DesktopFileSaveBridge;

            try {
                const savePath = await desktopFileBridge.saveFileDialog(
                    `${this.playlist.title || 'exported'}.m3u8`,
                    [
                        {
                            name: 'Playlist',
                            extensions: ['m3u8', 'm3u'],
                        },
                    ]
                );

                if (savePath) {
                    await desktopFileBridge.writeFile(
                        savePath,
                        playlistAsString
                    );
                    this.snackBar.open(
                        this.translate.instant(
                            'HOME.PLAYLISTS.INFO_DIALOG.PLAYLIST_EXPORT_SUCCESS'
                        ),
                        this.translate.instant('CLOSE'),
                        { duration: 3000 }
                    );
                }

                return;
            } catch (error) {
                console.error('Failed to export playlist:', error);
                this.snackBar.open(
                    this.translate.instant(
                        'HOME.PLAYLISTS.INFO_DIALOG.EXPORT_PLAYLIST_FAILED'
                    ),
                    this.translate.instant('CLOSE'),
                    {
                        duration: 3000,
                    }
                );
                return;
            }
        }

        this.downloadPlaylistFile(playlistAsString);
    }

    private downloadPlaylistFile(playlistAsString: string): void {
        const element = document.createElement('a');
        element.setAttribute(
            'href',
            'data:text/plain;charset=utf-8,' +
                encodeURIComponent(playlistAsString)
        );
        element.setAttribute('download', this.playlist.title || 'exported.m3u');
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }

    /**
     * Copy URL to clipboard
     */
    copyUrl(): void {
        const url = this.playlistDetails.get('url')?.value;
        if (url) {
            const success = this.clipboard.copy(url);
            if (success) {
                this.snackBar.open(
                    this.translate.instant(
                        'HOME.PLAYLISTS.INFO_DIALOG.URL_COPIED'
                    ),
                    this.translate.instant('CLOSE'),
                    { duration: 2000 }
                );
            }
        }
    }

    private normalizeEpgUrls(urls?: string[] | null): string[] {
        return normalizeEpgUrls(urls ?? []);
    }

    private createPlaylistEpgSourceControl(value = ''): FormControl<string> {
        return new FormControl(value, {
            nonNullable: true,
            validators: [Validators.pattern(EPG_URL_PATTERN)],
        });
    }

    private getRawDetectedPlaylistEpgUrls(): string[] {
        return this.normalizeEpgUrls(this.playlist.detectedEpgUrls);
    }

    private applyPlaylistEpgSourceState(
        state: ReturnType<typeof resolvePlaylistEpgSourceState>
    ): void {
        const playlistMeta = {
            _id: this.playlist._id,
            epgUrls: state.epgUrls,
            detectedEpgUrls: state.detectedEpgUrls,
            manualEpgUrls: state.manualEpgUrls,
            disabledEpgUrls: state.disabledEpgUrls,
        } as PlaylistMeta;

        this.playlist = {
            ...this.playlist,
            ...playlistMeta,
        };
        this.store.dispatch(
            PlaylistActions.updatePlaylistMeta({ playlist: playlistMeta })
        );
    }

    private resetPlaylistEpgSourceInputs(): void {
        this.playlistEpgSourceInputs.clear();
        this.playlistEpgSourceInputs.push(
            this.createPlaylistEpgSourceControl()
        );
    }
}

import { CommonModule } from '@angular/common';
import {
    Component,
    computed,
    inject,
    Input,
    OnDestroy,
    OnInit,
    signal,
    ViewEncapsulation,
} from '@angular/core';
import {
    FormArray,
    FormBuilder,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialog,
    MatDialogModule,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { EpgService } from '@iptvnator/epg/data-access';
import { SettingsContextService } from '@iptvnator/workspace/shell/util';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DialogService } from '@iptvnator/ui/components';
import {
    PlaylistActions,
    selectAllPlaylistsMeta,
    selectIsEpgAvailable,
} from '@iptvnator/m3u-state';
import { firstValueFrom, take } from 'rxjs';
import {
    DatabaseService,
    DataService,
    DbOperationEvent,
    PlaylistBackupImportSummary,
    PlaylistBackupService,
    PlaylistsService,
} from '@iptvnator/services';
import {
    EmbeddedMpvSupport,
    CoverSize,
    Language,
    normalizeExternalPlayerArguments,
    StartupBehavior,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsService } from './../services/settings.service';
import { SettingsAboutSectionComponent } from './settings-about-section.component';
import { SettingsBackupSectionComponent } from './settings-backup-section.component';
import {
    SettingsDeleteAllPlaylistsDialogComponent,
    SettingsDeleteAllPlaylistsDialogData,
} from './settings-delete-all-playlists-dialog.component';
import { SettingsEpgSectionComponent } from './settings-epg-section.component';
import { createEpgUrlControl } from './settings-form.utils';
import { SettingsGeneralSectionComponent } from './settings-general-section.component';
import {
    SettingsPlaylistDeleteSummary,
    SettingsSection,
} from './settings.models';
import {
    buildSettingsSectionNavItems,
    SETTINGS_COVER_SIZE_OPTIONS,
    SETTINGS_EMBEDDED_PLAYER_OPTIONS,
    SETTINGS_OS_PLAYER_OPTIONS,
    SETTINGS_STARTUP_BEHAVIOR_OPTIONS,
    SETTINGS_THEME_OPTIONS,
} from './settings-options';
import { SettingsPlaybackSectionComponent } from './settings-playback-section.component';
import { SettingsRemoteControlSectionComponent } from './settings-remote-control-section.component';
import { SettingsResetSectionComponent } from './settings-reset-section.component';
import { SettingsSectionScrollDirective } from './settings-section-scroll.directive';

@Component({
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
    host: {
        class: 'settings-page-host',
    },
    encapsulation: ViewEncapsulation.None,
    imports: [
        CommonModule,
        MatButtonModule,
        MatIconModule,
        ReactiveFormsModule,
        TranslateModule,
        MatDialogModule,
        SettingsAboutSectionComponent,
        SettingsBackupSectionComponent,
        SettingsEpgSectionComponent,
        SettingsGeneralSectionComponent,
        SettingsPlaybackSectionComponent,
        SettingsRemoteControlSectionComponent,
        SettingsResetSectionComponent,
        SettingsSectionScrollDirective,
    ],
})
export class SettingsComponent implements OnInit, OnDestroy {
    private dialogService = inject(DialogService);
    public dataService = inject(DataService);
    private epgService = inject(EpgService);
    private formBuilder = inject(FormBuilder);
    private playlistsService = inject(PlaylistsService);
    private router = inject(Router);
    private settingsService = inject(SettingsService);
    private snackBar = inject(MatSnackBar);
    private store = inject(Store);
    private translate = inject(TranslateService);
    private matDialog = inject(MatDialog);
    private playlistBackupService = inject(PlaylistBackupService);
    private readonly databaseService = inject(DatabaseService);
    private readonly dialogData = inject<{ isDialog: boolean } | null>(
        MAT_DIALOG_DATA,
        { optional: true }
    );

    @Input() isDialog = this.dialogData?.isDialog ?? false;
    /** List with available languages as enum */
    readonly languageEnum = Language;

    /** List with allowed formats as enum */
    readonly streamFormatEnum = StreamFormat;

    /** Flag that indicates whether the app runs in electron environment */
    readonly isDesktop = !!window.electron;
    readonly embeddedMpvSupport = signal<EmbeddedMpvSupport | null>(null);
    readonly supportsEmbeddedMpv = computed(
        () => this.isDesktop && !!this.embeddedMpvSupport()?.supported
    );

    isPwa = this.dataService.getAppEnvironment() === 'pwa';

    private readonly settingsCtx = inject(SettingsContextService);
    readonly activeSection = this.settingsCtx.activeSection;

    readonly osPlayers = computed(() => [
        ...(this.supportsEmbeddedMpv()
            ? [
                  {
                      id: VideoPlayer.EmbeddedMpv,
                      labelKey: 'SETTINGS.PLAYER_EMBEDDED_MPV',
                  },
              ]
            : []),
        ...SETTINGS_OS_PLAYER_OPTIONS,
    ]);

    /** Player options */
    readonly players = computed(() => [
        ...SETTINGS_EMBEDDED_PLAYER_OPTIONS,
        ...(this.isDesktop ? this.osPlayers() : []),
    ]);

    /** Current version of the app */
    version: string;

    /** Update message to show */
    updateMessage: string;

    /** EPG availability flag */
    epgAvailable$ = this.store.select(selectIsEpgAvailable);
    readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);

    readonly themeOptions = SETTINGS_THEME_OPTIONS;
    readonly coverSizeOptions = SETTINGS_COVER_SIZE_OPTIONS;
    readonly startupBehaviorOptions = SETTINGS_STARTUP_BEHAVIOR_OPTIONS;

    /** Settings form object */
    settingsForm = this.formBuilder.group({
        player: [VideoPlayer.VideoJs],
        ...(this.isDesktop ? { epgUrl: new FormArray([]) } : {}),
        streamFormat: StreamFormat.M3u8StreamFormat,
        openStreamOnDoubleClick: false,
        language: Language.ENGLISH,
        showCaptions: false,
        showDashboard: true,
        startupBehavior: StartupBehavior.FirstView,
        showExternalPlaybackBar: true,
        theme: Theme.SystemTheme,
        mpvPlayerPath: '',
        mpvPlayerArguments: '',
        mpvReuseInstance: false,
        vlcPlayerPath: '',
        vlcPlayerArguments: '',
        vlcReuseInstance: false,
        remoteControl: false,
        remoteControlPort: [
            8765,
            [
                Validators.required,
                Validators.min(1),
                Validators.max(65535),
                Validators.pattern(/^\d+$/),
            ],
        ],
        recordingFolder: '',
        coverSize: 'medium' as CoverSize,
        ...(this.isDesktop ? { preferUploadedEpgOverXtream: false } : {}),
    });

    /** Form array with epg sources */
    epgUrl = this.settingsForm.get('epgUrl') as FormArray;

    /** Local IP addresses for remote control URL display */
    localIpAddresses = signal<string[]>([]);

    /** Currently visible QR code IP (null = none visible) */
    visibleQrCodeIp = signal<string | null>(null);
    readonly isRemovingAllPlaylists = signal(false);
    readonly isClearingEpgData = signal(false);
    readonly isExportingData = signal(false);
    readonly removeAllProgress = signal<DbOperationEvent | null>(null);

    private settingsStore = inject(SettingsStore);
    readonly sectionNavItems: SettingsSection[] = buildSettingsSectionNavItems(
        this.isDesktop
    );

    readonly playlistDeleteSummary = computed<SettingsPlaylistDeleteSummary>(
        () => {
            const items = this.playlists();

            return {
                total: items.length,
                m3u: items.filter((item) => !item.serverUrl && !item.macAddress)
                    .length,
                xtream: items.filter((item) => Boolean(item.serverUrl)).length,
                stalker: items.filter((item) => Boolean(item.macAddress))
                    .length,
            };
        }
    );

    readonly canRemoveAllPlaylists = computed(
        () =>
            !this.isRemovingAllPlaylists() &&
            this.playlistDeleteSummary().total > 0
    );

    readonly removeAllProgressLabel = computed(() => {
        if (!this.isRemovingAllPlaylists()) {
            return null;
        }

        const progress = this.removeAllProgress();
        const current = progress?.current;
        const total = progress?.total;

        if (
            typeof current === 'number' &&
            typeof total === 'number' &&
            total > 0
        ) {
            return this.translate.instant('SETTINGS.REMOVE_ALL_PROGRESS', {
                current,
                total,
            });
        }

        return this.translate.instant('SETTINGS.REMOVE_ALL_IN_PROGRESS');
    });

    get sectionNav(): SettingsSection[] {
        return this.sectionNavItems.filter((section) => section.visible);
    }

    /**
     * Reads the config object from the browsers
     * storage (indexed db)
     */
    async ngOnInit(): Promise<void> {
        // Wait for settings to load before setting the form
        await this.settingsStore.loadSettings();
        this.setSettings();
        void this.loadEmbeddedMpvSupport();
        this.checkAppVersion();
        void this.fetchLocalIpAddresses();

        if (!this.isDialog) {
            this.settingsCtx.setSections(this.sectionNav);
        }
    }

    private async loadEmbeddedMpvSupport(): Promise<void> {
        if (!this.isDesktop) {
            this.embeddedMpvSupport.set({
                supported: false,
                platform: 'web',
                reason: 'Embedded MPV requires the Electron desktop build.',
            });
            return;
        }

        if (!window.electron?.getEmbeddedMpvSupport) {
            this.embeddedMpvSupport.set({
                supported: false,
                platform: window.electron.platform,
                reason: 'Embedded MPV support is not available in this build.',
            });
            return;
        }

        try {
            this.embeddedMpvSupport.set(
                await window.electron.getEmbeddedMpvSupport()
            );
        } catch (error) {
            this.embeddedMpvSupport.set({
                supported: false,
                platform: window.electron.platform,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    ngOnDestroy(): void {
        this.settingsCtx.reset();
    }

    /**
     * Fetches local IP addresses for remote control URL display
     */
    async fetchLocalIpAddresses(): Promise<void> {
        if (window.electron?.getLocalIpAddresses) {
            const addresses = await window.electron.getLocalIpAddresses();
            this.localIpAddresses.set(addresses);
        }
    }

    /**
     * Toggle QR code visibility for a given IP address
     */
    toggleQrCode(ip: string): void {
        if (this.visibleQrCodeIp() === ip) {
            this.visibleQrCodeIp.set(null);
        } else {
            this.visibleQrCodeIp.set(ip);
        }
    }

    /**
     * Sets saved settings from the indexed db store
     */
    setSettings() {
        const currentSettings = this.settingsStore.getSettings();
        this.settingsForm.patchValue(currentSettings);

        if (this.isDesktop && currentSettings.epgUrl) {
            this.epgUrl.clear();
            this.setEpgUrls(currentSettings.epgUrl);
        }
    }

    selectTheme(theme: Theme): void {
        if (this.settingsForm.value.theme === theme) {
            return;
        }

        this.settingsForm.patchValue({ theme });
        this.settingsForm.get('theme')?.markAsDirty();
        this.settingsForm.markAsDirty();
        this.settingsService.changeTheme(theme);
    }

    selectCoverSize(size: CoverSize): void {
        if (this.settingsForm.value.coverSize === size) {
            return;
        }

        this.settingsForm.patchValue({ coverSize: size });
        this.settingsForm.get('coverSize')?.markAsDirty();
        this.settingsForm.markAsDirty();
        this.settingsStore.updateSettings({ coverSize: size });
    }

    async selectRecordingFolder(): Promise<void> {
        if (
            !this.isDesktop ||
            !window.electron?.selectEmbeddedMpvRecordingFolder
        ) {
            return;
        }

        const folder = await window.electron.selectEmbeddedMpvRecordingFolder();
        if (!folder) {
            return;
        }

        this.settingsForm.patchValue({ recordingFolder: folder });
        this.settingsForm.get('recordingFolder')?.markAsDirty();
        this.settingsForm.markAsDirty();
    }

    /**
     * Sets the epg urls to the form array
     * @param epgUrls urls of the EPG sources
     */
    setEpgUrls(epgUrls: string[] | string): void {
        const urls = Array.isArray(epgUrls) ? epgUrls : [epgUrls];
        const filteredUrls = urls
            .map((url) => url.trim())
            .filter((url) => url !== '');

        filteredUrls.forEach((url) => {
            this.epgUrl.push(createEpgUrlControl(url));
        });
    }

    /**
     * Checks whether the latest version of the application
     * is used and updates the version message in the
     * settings UI
     */
    checkAppVersion(): void {
        this.settingsService
            .getAppVersion()
            .pipe(take(1))
            .subscribe((version) => this.showVersionInformation(version));
    }

    /**
     * Updates the message in settings UI about the used
     * version of the app
     * @param currentVersion current version of the application
     */
    showVersionInformation(currentVersion: string): void {
        const isOutdated = this.isCurrentVersionOutdated(currentVersion);

        if (isOutdated) {
            this.updateMessage = `${
                this.translate.instant(
                    'SETTINGS.NEW_VERSION_AVAILABLE'
                ) as string
            }: ${currentVersion}`;
        } else {
            this.updateMessage = this.translate.instant(
                'SETTINGS.LATEST_VERSION'
            );
        }
    }

    /**
     * Compares actual with latest version of the
     * application
     * @param latestVersion latest version
     * @returns returns true if an update is available
     */
    isCurrentVersionOutdated(latestVersion: string): boolean {
        this.version = this.dataService.getAppVersion();
        return this.settingsService.isVersionOutdated(
            this.version,
            latestVersion
        );
    }

    /**
     * Triggers on form submit and saves the config object to
     * the indexed db store
     */
    onSubmit(): void {
        const settings = {
            ...this.settingsForm.value,
            mpvPlayerPath: this.normalizeExternalPlayerPath(
                this.settingsForm.value.mpvPlayerPath
            ),
            vlcPlayerPath: this.normalizeExternalPlayerPath(
                this.settingsForm.value.vlcPlayerPath
            ),
            mpvPlayerArguments: normalizeExternalPlayerArguments(
                this.settingsForm.value.mpvPlayerArguments
            ),
            vlcPlayerArguments: normalizeExternalPlayerArguments(
                this.settingsForm.value.vlcPlayerArguments
            ),
        };

        this.settingsStore.updateSettings(settings).then(() => {
            this.applyChangedSettings();

            if (window.electron) {
                window.electron.updateSettings(settings);

                window.electron.setMpvPlayerPath(settings.mpvPlayerPath);
                window.electron.setVlcPlayerPath(settings.vlcPlayerPath);
            }
        });
        if (this.isDialog) {
            this.matDialog.closeAll();
        }
    }

    private normalizeExternalPlayerPath(
        playerPath: string | null | undefined
    ): string {
        return playerPath?.trim() ?? '';
    }

    /**
     * Applies the changed settings to the app
     */
    applyChangedSettings(): void {
        this.settingsForm.markAsPristine();
        if (this.isDesktop) {
            let epgUrls = this.settingsForm.value.epgUrl;
            if (epgUrls) {
                if (!Array.isArray(epgUrls)) {
                    epgUrls = [epgUrls];
                }
                epgUrls = epgUrls.filter((url) => url !== '');
                if (epgUrls.length > 0) {
                    // Fetch all EPG URLs at once
                    this.epgService.fetchEpg(epgUrls);
                }
            }
        }
        this.translate.use(this.settingsForm.value.language);
        this.settingsService.changeTheme(
            this.settingsForm.value.theme ?? Theme.SystemTheme
        );
        this.openSettingsSnackbar(
            this.translate.instant('SETTINGS.SETTINGS_SAVED')
        );
    }

    /**
     * Navigates back to the applications homepage
     */
    backToHome(): void {
        if (this.isDialog) {
            this.matDialog.closeAll();
        } else {
            this.router.navigateByUrl('/');
        }
    }

    /**
     * Force-fetch EPG for a single URL, bypassing the 12-hour freshness check.
     * The plain fetchEpg would short-circuit on fresh data and click the
     * refresh button would be a no-op — that's exactly not what the user
     * intends when clicking "Refresh".
     */
    refreshEpg(url: string): void {
        if (!url || !window.electron?.forceFetchEpg) return;
        void window.electron.forceFetchEpg(url);
    }

    /**
     * Force-fetch every configured EPG URL sequentially. Empty fields are
     * skipped. Each URL flows through the normal progress panel so the user
     * gets visible per-URL feedback.
     */
    refreshAllEpg(): void {
        if (!window.electron?.forceFetchEpg) return;
        const urls = (this.epgUrl.value as string[])
            .map((url) => url?.trim())
            .filter((url): url is string => Boolean(url));
        urls.forEach((url) => window.electron.forceFetchEpg(url));
    }

    /**
     * Initializes new entry in form array for EPG URL
     */
    addEpgSource(): void {
        this.epgUrl.insert(this.epgUrl.length, createEpgUrlControl());
    }

    /**
     * Removes entry from form array for EPG URL
     * @param index index of the item to remove
     */
    removeEpgSource(index: number): void {
        this.epgUrl.removeAt(index);
        this.settingsForm.markAsDirty();
    }

    /**
     * Clears all EPG data from database and immediately re-fetches every
     * configured URL so the user isn't left staring at an empty state.
     * Tracks progress with `isClearingEpgData` so the UI can show a spinner
     * and block double-clicks, and surfaces failures via a dedicated snackbar.
     */
    clearEpgData(): void {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant('SETTINGS.CLEAR_EPG_DIALOG.TITLE'),
            message: this.translate.instant(
                'SETTINGS.CLEAR_EPG_DIALOG.MESSAGE'
            ),
            onConfirm: async (): Promise<void> => {
                if (
                    !window.electron?.clearEpgData ||
                    this.isClearingEpgData()
                ) {
                    return;
                }

                this.isClearingEpgData.set(true);
                try {
                    const result = await window.electron.clearEpgData();
                    if (result && result.success === false) {
                        throw new Error('Clear EPG returned success=false');
                    }
                    this.openSettingsSnackbar(
                        this.translate.instant('SETTINGS.EPG_DATA_CLEARED')
                    );
                    this.refreshAllEpg();
                } catch (error) {
                    console.error('Failed to clear EPG data:', error);
                    this.openSettingsSnackbar(
                        this.translate.instant('SETTINGS.EPG_DATA_CLEAR_FAILED')
                    );
                } finally {
                    this.isClearingEpgData.set(false);
                }
            },
        });
    }

    async exportData() {
        if (this.isExportingData()) {
            return;
        }

        this.isExportingData.set(true);

        // Let Angular paint the busy state before the backup build and native
        // save dialog handoff start.
        await this.waitForUiFeedbackFrame();

        try {
            const backup = await this.playlistBackupService.exportBackup();

            if (this.isDesktop && window.electron?.saveFileDialog) {
                const savePath = await window.electron.saveFileDialog(
                    backup.defaultFileName,
                    [
                        {
                            name: 'JSON',
                            extensions: ['json'],
                        },
                    ]
                );

                if (!savePath) {
                    return;
                }

                await window.electron.writeFile(savePath, backup.json);
            } else {
                const blob = new Blob([backup.json], {
                    type: 'application/json',
                });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = backup.defaultFileName;
                link.click();
                window.URL.revokeObjectURL(url);
            }

            this.openSettingsSnackbar('Playlist backup exported.');
        } catch (error) {
            console.error('Failed to export playlist backup:', error);
            this.openSettingsSnackbar('Playlist backup export failed.');
        } finally {
            this.isExportingData.set(false);
        }
    }

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';

        input.addEventListener('change', async (event: Event) => {
            const target = event.target as HTMLInputElement;
            const file = target.files?.[0];

            if (file) {
                try {
                    const summary =
                        await this.playlistBackupService.importBackup(
                            await file.text()
                        );

                    if (summary.imported > 0 || summary.merged > 0) {
                        this.store.dispatch(
                            PlaylistActions.removeAllPlaylists()
                        );
                        this.store.dispatch(PlaylistActions.loadPlaylists());
                    }

                    this.setSettings();
                    this.openSettingsSnackbar(
                        this.buildBackupImportSummary(summary)
                    );

                    if (summary.errors.length > 0) {
                        console.error(
                            'Playlist backup import completed with issues:',
                            summary.errors
                        );
                    }
                } catch (error) {
                    console.error('Failed to import playlist backup:', error);
                    this.openSettingsSnackbar(
                        error instanceof Error
                            ? error.message
                            : this.translate.instant('SETTINGS.IMPORT_ERROR')
                    );
                }
            }
        });

        input.click();
    }

    private buildBackupImportSummary(
        summary: PlaylistBackupImportSummary
    ): string {
        return `Backup import finished: ${summary.imported} imported, ${summary.merged} merged, ${summary.skipped} skipped, ${summary.failed} failed.`;
    }

    private async waitForUiFeedbackFrame(): Promise<void> {
        if (typeof window.requestAnimationFrame !== 'function') {
            await Promise.resolve();
            return;
        }

        await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => resolve());
        });
    }

    removeAll(): void {
        if (!this.canRemoveAllPlaylists()) {
            return;
        }

        this.matDialog
            .open<
                SettingsDeleteAllPlaylistsDialogComponent,
                SettingsDeleteAllPlaylistsDialogData,
                boolean
            >(SettingsDeleteAllPlaylistsDialogComponent, {
                autoFocus: false,
                data: {
                    summary: this.playlistDeleteSummary(),
                },
                maxWidth: 'calc(100vw - 32px)',
                restoreFocus: true,
                width: '460px',
            })
            .afterClosed()
            .pipe(take(1))
            .subscribe((confirmed) => {
                if (confirmed) {
                    void this.removeAllConfirmed();
                }
            });
    }

    private async removeAllConfirmed(): Promise<void> {
        if (this.isRemovingAllPlaylists()) {
            return;
        }

        this.isRemovingAllPlaylists.set(true);
        this.removeAllProgress.set(null);

        await this.waitForUiFeedbackFrame();

        try {
            const deleted =
                this.isDesktop && window.electron
                    ? await this.deleteAllPlaylistsInElectron()
                    : await this.deleteAllPlaylistsInBrowser();

            if (!deleted) {
                throw new Error('Delete all playlists returned success=false');
            }

            this.store.dispatch(PlaylistActions.removeAllPlaylists());
            this.openSettingsSnackbar(
                this.translate.instant('SETTINGS.PLAYLISTS_REMOVED')
            );
        } catch (error) {
            console.error('Error removing playlists:', error);
            this.openSettingsSnackbar(
                this.translate.instant('SETTINGS.PLAYLISTS_REMOVE_FAILED')
            );
        } finally {
            this.removeAllProgress.set(null);
            this.isRemovingAllPlaylists.set(false);
        }
    }

    private async deleteAllPlaylistsInElectron(): Promise<boolean> {
        return this.databaseService.deleteAllPlaylists({
            operationId: this.databaseService.createOperationId(
                'settings-delete-all-playlists'
            ),
            onEvent: (event) => this.handleDeleteAllPlaylistsEvent(event),
        });
    }

    private async deleteAllPlaylistsInBrowser(): Promise<boolean> {
        await firstValueFrom(this.playlistsService.removeAll());
        return true;
    }

    private handleDeleteAllPlaylistsEvent(event: DbOperationEvent): void {
        this.removeAllProgress.set(event);
    }

    private openSettingsSnackbar(
        message: string,
        config: MatSnackBarConfig = {}
    ): void {
        this.snackBar.open(message, undefined, {
            duration: 2000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: ['settings-snackbar'],
            ...config,
        });
    }
}

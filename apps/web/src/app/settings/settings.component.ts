import { CommonModule } from '@angular/common';
import {
    Component,
    computed,
    inject,
    Input,
    DestroyRef,
    OnDestroy,
    OnInit,
    signal,
    ViewEncapsulation,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialog,
    MatDialogModule,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import {
    EpgRuntimeBridgeService,
    EpgService,
} from '@iptvnator/epg/data-access';
import { SettingsContextService } from '@iptvnator/workspace/shell/util';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DialogService } from '@iptvnator/ui/components';
import {
    selectAllPlaylistsMeta,
    selectIsEpgAvailable,
} from '@iptvnator/m3u-state';
import { take } from 'rxjs';
import { DataService, RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    EmbeddedMpvSupport,
    CoverSize,
    Language,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsService } from './../services/settings.service';
import { SettingsAboutSectionComponent } from './settings-about-section.component';
import { SettingsBackupSectionComponent } from './settings-backup-section.component';
import { SettingsDashboardSectionComponent } from './settings-dashboard-section.component';
import {
    SettingsDeleteAllPlaylistsDialogComponent,
    SettingsDeleteAllPlaylistsDialogData,
} from './settings-delete-all-playlists-dialog.component';
import { SettingsEpgSectionComponent } from './settings-epg-section.component';
import {
    applyEpgUrlsToFormArray,
    createEpgUrlControl,
    createSettingsForm,
    createSettingsFromFormValue,
} from './settings-form.utils';
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
import { SettingsBackupFacade } from './settings-backup.facade';
import { SettingsPlaylistResetFacade } from './settings-playlist-reset.facade';
import {
    buildRemoveAllProgressLabel,
    buildSettingsPlaylistDeleteSummary,
} from './settings-playlist-summary.utils';
import { SettingsSnackbarService } from './settings-snackbar.service';

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
        SettingsDashboardSectionComponent,
        SettingsEpgSectionComponent,
        SettingsGeneralSectionComponent,
        SettingsPlaybackSectionComponent,
        SettingsRemoteControlSectionComponent,
        SettingsResetSectionComponent,
        SettingsSectionScrollDirective,
    ],
    providers: [
        SettingsBackupFacade,
        SettingsPlaylistResetFacade,
        SettingsSnackbarService,
    ],
})
export class SettingsComponent implements OnInit, OnDestroy {
    private dialogService = inject(DialogService);
    public dataService = inject(DataService);
    private epgService = inject(EpgService);
    private formBuilder = inject(FormBuilder);
    private destroyRef = inject(DestroyRef);
    private router = inject(Router);
    private settingsService = inject(SettingsService);
    private settingsSnackbar = inject(SettingsSnackbarService);
    private store = inject(Store);
    private translate = inject(TranslateService);
    private matDialog = inject(MatDialog);
    private readonly backupFacade = inject(SettingsBackupFacade);
    private readonly playlistResetFacade = inject(SettingsPlaylistResetFacade);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
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
    readonly isDesktop = this.runtime.isElectron;
    readonly supportsDesktopFileSave = this.runtime.supportsDesktopFileSave;
    readonly supportsEpg =
        this.epgBridge.supportsImport && this.epgBridge.supportsDataManagement;
    readonly supportsManagedExternalPlayers =
        this.runtime.supportsManagedExternalPlayers;
    readonly supportsExternalPlayerPathSettings =
        this.runtime.supportsExternalPlayerPathSettings;
    readonly supportsRemoteControl = this.runtime.supportsRemoteControl;
    readonly embeddedMpvSupport = signal<EmbeddedMpvSupport | null>(null);
    readonly supportsEmbeddedMpv = computed(
        () => this.isDesktop && !!this.embeddedMpvSupport()?.supported
    );

    readonly isPwa = this.runtime.isPwa;

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
        ...(this.supportsManagedExternalPlayers
            ? SETTINGS_OS_PLAYER_OPTIONS
            : []),
    ]);

    /** Player options */
    readonly players = computed(() => [
        ...SETTINGS_EMBEDDED_PLAYER_OPTIONS,
        ...this.osPlayers(),
    ]);

    /** Current version of the app */
    version = '';

    /** Update message to show */
    updateMessage = '';

    /** EPG availability flag */
    epgAvailable$ = this.store.select(selectIsEpgAvailable);
    readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);

    readonly themeOptions = SETTINGS_THEME_OPTIONS;
    readonly coverSizeOptions = SETTINGS_COVER_SIZE_OPTIONS;
    readonly startupBehaviorOptions = SETTINGS_STARTUP_BEHAVIOR_OPTIONS;

    /** Settings form object */
    settingsForm = createSettingsForm(this.formBuilder, this.supportsEpg);

    /** Form array with epg sources */
    epgUrl = this.settingsForm.get('epgUrl') as FormArray;

    /** Local IP addresses for remote control URL display */
    localIpAddresses = signal<string[]>([]);

    /** Currently visible QR code IP (null = none visible) */
    visibleQrCodeIp = signal<string | null>(null);
    readonly isRemovingAllPlaylists =
        this.playlistResetFacade.isRemovingAllPlaylists;
    readonly isClearingEpgData = signal(false);
    readonly isExportingData = this.backupFacade.isExportingData;
    readonly removeAllProgress = this.playlistResetFacade.removeAllProgress;

    private settingsStore = inject(SettingsStore);
    readonly sectionNavItems: SettingsSection[] = buildSettingsSectionNavItems({
        supportsEpg: this.supportsEpg,
        supportsRemoteControl: this.supportsRemoteControl,
    });

    readonly playlistDeleteSummary = computed<SettingsPlaylistDeleteSummary>(
        () => buildSettingsPlaylistDeleteSummary(this.playlists())
    );

    readonly canRemoveAllPlaylists = computed(
        () =>
            !this.isRemovingAllPlaylists() &&
            this.playlistDeleteSummary().total > 0
    );

    readonly removeAllProgressLabel = computed(() => {
        return buildRemoveAllProgressLabel({
            isRemovingAllPlaylists: this.isRemovingAllPlaylists(),
            progress: this.removeAllProgress(),
            translate: (key, params) => this.translate.instant(key, params),
        });
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
        this.bindDashboardControlsEnabledState();
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
        if (
            this.supportsRemoteControl &&
            window.electron?.getLocalIpAddresses
        ) {
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
        this.syncDashboardControlsEnabledState(
            currentSettings.showDashboard ?? true
        );

        if (this.supportsEpg && currentSettings.epgUrl) {
            this.epgUrl.clear();
            this.setEpgUrls(currentSettings.epgUrl);
        }
    }

    private bindDashboardControlsEnabledState(): void {
        this.settingsForm
            .get('showDashboard')
            ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((showDashboard) =>
                this.syncDashboardControlsEnabledState(showDashboard ?? true)
            );
    }

    private syncDashboardControlsEnabledState(showDashboard: boolean): void {
        const dashboardRails = this.settingsForm.get('dashboardRails');
        if (!dashboardRails) {
            return;
        }

        if (showDashboard) {
            dashboardRails.enable({ emitEvent: false });
        } else {
            dashboardRails.disable({ emitEvent: false });
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
        applyEpgUrlsToFormArray(this.epgUrl, epgUrls);
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
        const settings = this.createSettingsFromFormValue();

        this.settingsStore.updateSettings(settings).then(() => {
            this.applyChangedSettings();

            if (window.electron) {
                window.electron.updateSettings(settings);
            }

            if (this.supportsExternalPlayerPathSettings && window.electron) {
                window.electron.setMpvPlayerPath(settings.mpvPlayerPath);
                window.electron.setVlcPlayerPath(settings.vlcPlayerPath);
            }
        });
        if (this.isDialog) {
            this.matDialog.closeAll();
        }
    }

    private createSettingsFromFormValue() {
        return createSettingsFromFormValue(
            this.settingsForm,
            this.settingsStore.getSettings()
        );
    }

    /**
     * Applies the changed settings to the app
     */
    applyChangedSettings(): void {
        this.settingsForm.markAsPristine();
        if (this.supportsEpg) {
            let epgUrls = this.settingsForm.value.epgUrl;
            if (epgUrls) {
                if (!Array.isArray(epgUrls)) {
                    epgUrls = [epgUrls];
                }
                const validEpgUrls = epgUrls.filter(
                    (url): url is string =>
                        typeof url === 'string' && url !== ''
                );
                if (validEpgUrls.length > 0) {
                    // Fetch all EPG URLs at once
                    this.epgService.fetchEpg(validEpgUrls);
                }
            }
        }
        this.translate.use(
            this.settingsForm.value.language ?? Language.ENGLISH
        );
        this.settingsService.changeTheme(
            this.settingsForm.value.theme ?? Theme.SystemTheme
        );
        this.settingsSnackbar.open(
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
        if (!this.epgBridge.supportsDataManagement || !url) {
            return;
        }
        void this.epgBridge.forceFetchEpg(
            url,
            this.settingsStore.getTrustOptions()
        );
    }

    /**
     * Force-fetch every configured EPG URL sequentially. Empty fields are
     * skipped. Each URL flows through the normal progress panel so the user
     * gets visible per-URL feedback.
     */
    refreshAllEpg(): void {
        if (!this.epgBridge.supportsDataManagement) return;
        const urls = (this.epgUrl.value as string[])
            .map((url) => url?.trim())
            .filter((url): url is string => Boolean(url));
        const options = this.settingsStore.getTrustOptions();
        urls.forEach((url) => void this.epgBridge.forceFetchEpg(url, options));
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
                    !this.epgBridge.supportsDataManagement ||
                    this.isClearingEpgData()
                ) {
                    return;
                }

                this.isClearingEpgData.set(true);
                try {
                    const result = await this.epgBridge.clearEpgData();
                    if (result && result.success === false) {
                        throw new Error('Clear EPG returned success=false');
                    }
                    this.settingsSnackbar.open(
                        this.translate.instant('SETTINGS.EPG_DATA_CLEARED')
                    );
                    this.refreshAllEpg();
                } catch (error) {
                    console.error('Failed to clear EPG data:', error);
                    this.settingsSnackbar.open(
                        this.translate.instant('SETTINGS.EPG_DATA_CLEAR_FAILED')
                    );
                } finally {
                    this.isClearingEpgData.set(false);
                }
            },
        });
    }

    async exportData() {
        await this.backupFacade.exportData(() => this.waitForUiFeedbackFrame());
    }

    importData() {
        this.backupFacade.importData(() => this.setSettings());
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
                    void this.playlistResetFacade.removeAllConfirmed(() =>
                        this.waitForUiFeedbackFrame()
                    );
                }
            });
    }
}

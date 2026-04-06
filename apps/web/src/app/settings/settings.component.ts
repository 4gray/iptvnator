import { CommonModule } from '@angular/common';
import {
    Component,
    ElementRef,
    effect,
    inject,
    Injector,
    Input,
    OnDestroy,
    OnInit,
    signal,
} from '@angular/core';
import {
    FormArray,
    FormBuilder,
    FormControl,
    FormsModule,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialog,
    MatDialogModule,
} from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import {
    MatSnackBar,
    MatSnackBarConfig,
} from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EpgService } from '@iptvnator/epg/data-access';
import { QRCodeComponent } from 'angularx-qrcode';
import { DialogService } from 'components';
import { PlaylistActions, selectIsEpgAvailable } from 'm3u-state';
import { firstValueFrom, take } from 'rxjs';
import { DataService, PlaylistsService } from 'services';
import {
    Language,
    Playlist,
    StartupBehavior,
    StreamFormat,
    Theme,
    VideoPlayer,
} from 'shared-interfaces';
import { SettingsContextService } from '@iptvnator/workspace/shell/util';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsService } from './../services/settings.service';

interface SettingsSection {
    id: string;
    label: string;
    icon: string;
    visible: boolean;
}

interface ObservedSettingsSection {
    id: string;
    element: HTMLElement;
}

interface ThemeOption {
    value: Theme;
    icon: string;
    labelKey: string;
}

interface StartupBehaviorOption {
    value: StartupBehavior;
    labelKey: string;
}

@Component({
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatCheckboxModule,
        MatDividerModule,
        MatIconModule,
        MatInputModule,
        MatProgressSpinnerModule,
        MatSelectModule,
        MatTooltipModule,
        ReactiveFormsModule,
        TranslateModule,
        MatDialogModule,
        QRCodeComponent,
    ],
})
export class SettingsComponent implements OnInit, OnDestroy {
    private static readonly SECTION_SCROLL_TOP_GUTTER = 112;
    private static readonly SECTION_SCROLL_BOTTOM_GUTTER = 124;
    private static readonly PENDING_SCROLL_CLEAR_DELAY_MS = 600;

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
    private readonly elementRef = inject(ElementRef<HTMLElement>);
    private readonly injector = inject(Injector);
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

    isPwa = this.dataService.getAppEnvironment() === 'pwa';

    private readonly settingsCtx = inject(SettingsContextService);
    readonly activeSection = this.settingsCtx.activeSection;

    readonly osPlayers = [
        {
            id: VideoPlayer.MPV,
            labelKey: 'SETTINGS.PLAYER_MPV',
        },
        {
            id: VideoPlayer.VLC,
            labelKey: 'SETTINGS.PLAYER_VLC',
        },
    ];

    /** Player options */
    readonly players = [
        {
            id: VideoPlayer.Html5Player,
            labelKey: 'SETTINGS.PLAYER_HTML5',
        },
        {
            id: VideoPlayer.VideoJs,
            labelKey: 'SETTINGS.PLAYER_VIDEOJS',
        },
        {
            id: VideoPlayer.ArtPlayer,
            labelKey: 'SETTINGS.PLAYER_ARTPLAYER',
        },
        ...(this.isDesktop ? this.osPlayers : []),
    ];

    /** Current version of the app */
    version: string;

    /** Update message to show */
    updateMessage: string;

    /** EPG availability flag */
    epgAvailable$ = this.store.select(selectIsEpgAvailable);

    readonly themeOptions: ThemeOption[] = [
        {
            value: Theme.LightTheme,
            icon: 'light_mode',
            labelKey: 'THEMES.LIGHT_THEME',
        },
        {
            value: Theme.DarkTheme,
            icon: 'dark_mode',
            labelKey: 'THEMES.DARK_THEME',
        },
        {
            value: Theme.SystemTheme,
            icon: 'desktop_windows',
            labelKey: 'THEMES.SYSTEM_THEME',
        },
    ];

    readonly startupBehaviorOptions: StartupBehaviorOption[] = [
        {
            value: StartupBehavior.FirstView,
            labelKey: 'SETTINGS.STARTUP_BEHAVIOR_FIRST_VIEW',
        },
        {
            value: StartupBehavior.RestoreLastView,
            labelKey: 'SETTINGS.STARTUP_BEHAVIOR_RESTORE_LAST_VIEW',
        },
    ];

    /** Settings form object */
    settingsForm = this.formBuilder.group({
        player: [VideoPlayer.VideoJs],
        ...(this.isDesktop ? { epgUrl: new FormArray([]) } : {}),
        streamFormat: StreamFormat.M3u8StreamFormat,
        language: Language.ENGLISH,
        showCaptions: false,
        showDashboard: true,
        startupBehavior: StartupBehavior.FirstView,
        showExternalPlaybackBar: true,
        theme: Theme.SystemTheme,
        mpvPlayerPath: '',
        mpvReuseInstance: false,
        vlcPlayerPath: '',
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
    });

    /** Form array with epg sources */
    epgUrl = this.settingsForm.get('epgUrl') as FormArray;

    /** Local IP addresses for remote control URL display */
    localIpAddresses = signal<string[]>([]);

    /** Currently visible QR code IP (null = none visible) */
    visibleQrCodeIp = signal<string | null>(null);
    readonly isRemovingAllPlaylists = signal(false);

    private settingsStore = inject(SettingsStore);
    private sectionObserver?: IntersectionObserver;
    private pendingScrollClearTimer: ReturnType<typeof window.setTimeout> | null =
        null;
    private pendingScrollClearRoot: HTMLElement | null = null;
    private pendingScrollEndListener: (() => void) | null = null;

    readonly sectionNavItems: SettingsSection[] = [
        {
            id: 'general',
            label: 'SETTINGS.NAV_GENERAL',
            icon: 'tune',
            visible: true,
        },
        {
            id: 'playback',
            label: 'SETTINGS.NAV_PLAYBACK',
            icon: 'play_circle',
            visible: true,
        },
        {
            id: 'epg',
            label: 'SETTINGS.NAV_EPG',
            icon: 'calendar_month',
            visible: this.isDesktop,
        },
        {
            id: 'remote-control',
            label: 'SETTINGS.NAV_REMOTE',
            icon: 'smartphone',
            visible: this.isDesktop,
        },
        {
            id: 'data',
            label: 'SETTINGS.NAV_DATA',
            icon: 'swap_horiz',
            visible: true,
        },
        {
            id: 'about',
            label: 'SETTINGS.NAV_ABOUT',
            icon: 'info',
            visible: true,
        },
    ];

    constructor() {
        effect(
            () => {
                const sectionId = this.settingsCtx.pendingScrollTarget();
                if (!sectionId || typeof document === 'undefined') {
                    return;
                }

                const scrollRoot = this.scrollToSection(sectionId);
                this.schedulePendingScrollTargetClear(scrollRoot);
            },
            { injector: this.injector }
        );

        effect(
            (onCleanup) => {
                const activeSectionId = this.activeSection();
                const activeSectionElement =
                    this.elementRef.nativeElement.querySelector(
                        `#${activeSectionId}`
                    ) as HTMLElement | null;

                if (!activeSectionElement) {
                    return;
                }

                const animation = activeSectionElement.animate(
                    [
                        {
                            boxShadow:
                                'inset 0 0 0 1px var(--settings-group-active-ring), 0 8px 18px -24px var(--settings-group-active-glow)',
                        },
                        {
                            boxShadow:
                                'inset 0 0 0 1px var(--settings-group-active-ring), 0 12px 22px -24px var(--settings-group-active-glow)',
                        },
                        {
                            boxShadow:
                                'inset 0 0 0 1px var(--settings-group-active-ring), 0 8px 18px -24px var(--settings-group-active-glow)',
                        },
                    ],
                    {
                        duration: 260,
                        easing: 'ease-out',
                    }
                );

                onCleanup(() => animation.cancel());
            },
            { injector: this.injector }
        );
    }

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
        this.checkAppVersion();
        this.fetchLocalIpAddresses();

        if (!this.isDialog) {
            this.settingsCtx.setSections(this.sectionNav);
        }

        requestAnimationFrame(() => this.setupSectionObserver());
    }

    ngOnDestroy(): void {
        this.cancelPendingScrollTargetClear();
        this.sectionObserver?.disconnect();
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

    /**
     * Sets the epg urls to the form array
     * @param epgUrls urls of the EPG sources
     */
    setEpgUrls(epgUrls: string[] | string): void {
        const URL_REGEX = /^(http|https|file):\/\/[^ "]+$/;

        const urls = Array.isArray(epgUrls) ? epgUrls : [epgUrls];
        const filteredUrls = urls
            .map((url) => url.trim())
            .filter((url) => url !== '');

        filteredUrls.forEach((url) => {
            this.epgUrl.push(
                new FormControl(url, [Validators.pattern(URL_REGEX)])
            );
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
        this.settingsStore.updateSettings(this.settingsForm.value).then(() => {
            this.applyChangedSettings();

            if (window.electron) {
                window.electron.updateSettings(this.settingsForm.value);

                // Set player paths if using external players
                if (this.settingsForm.value.mpvPlayerPath) {
                    window.electron.setMpvPlayerPath(
                        this.settingsForm.value.mpvPlayerPath
                    );
                }
                if (this.settingsForm.value.vlcPlayerPath) {
                    window.electron.setVlcPlayerPath(
                        this.settingsForm.value.vlcPlayerPath
                    );
                }
            }
        });
        if (this.isDialog) {
            this.matDialog.closeAll();
        }
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
     * Fetches and updates EPG from the given URL
     * @param url epg source url
     */
    refreshEpg(url: string): void {
        this.epgService.fetchEpg([url]);
    }

    /**
     * Initializes new entry in form array for EPG URL
     */
    addEpgSource(): void {
        this.epgUrl.insert(
            this.epgUrl.length,
            new FormControl('', {
                validators: [
                    Validators.pattern(/^(http|https|file):\/\/[^ "]+$/),
                ],
            })
        );
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
     * Clears all EPG data from database
     */
    clearEpgData(): void {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant('SETTINGS.CLEAR_EPG_DIALOG.TITLE'),
            message: this.translate.instant(
                'SETTINGS.CLEAR_EPG_DIALOG.MESSAGE'
            ),
            onConfirm: async (): Promise<void> => {
                if (window.electron?.clearEpgData) {
                    await window.electron.clearEpgData();
                    this.openSettingsSnackbar(
                        this.translate.instant('SETTINGS.EPG_DATA_CLEARED')
                    );
                }
            },
        });
    }

    exportData() {
        this.playlistsService
            .getAllData()
            .pipe(take(1))
            .subscribe((data) => {
                const blob = new Blob([JSON.stringify(data)], {
                    type: 'text/plain',
                });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'playlists.json';
                link.click();
                window.URL.revokeObjectURL(url);
            });
    }

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';

        input.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLInputElement;
            const file = target.files?.[0];

            if (file) {
                const reader = new FileReader();
                reader.onload = () => {
                    const contents = reader.result;

                    try {
                        const parsedPlaylists: Playlist[] = JSON.parse(
                            contents.toString()
                        );

                        if (!Array.isArray(parsedPlaylists)) {
                            this.openSettingsSnackbar(
                                this.translate.instant('SETTINGS.IMPORT_ERROR'),
                            );
                        } else {
                            this.store.dispatch(
                                PlaylistActions.addManyPlaylists({
                                    playlists: parsedPlaylists,
                                })
                            );
                        }
                    } catch (error) {
                        this.openSettingsSnackbar(
                            this.translate.instant('SETTINGS.IMPORT_ERROR'),
                        );
                        console.error(error);
                    }
                };
                reader.readAsText(file);
            }
        });

        input.click();
    }

    removeAll() {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant('SETTINGS.REMOVE_DIALOG.TITLE'),
            message: this.translate.instant('SETTINGS.REMOVE_DIALOG.MESSAGE'),
            onConfirm: async (): Promise<void> => {
                if (this.isRemovingAllPlaylists()) {
                    return;
                }

                this.isRemovingAllPlaylists.set(true);

                try {
                    await firstValueFrom(this.playlistsService.removeAll());
                    this.store.dispatch(PlaylistActions.removeAllPlaylists());
                    this.openSettingsSnackbar(
                        this.translate.instant('SETTINGS.PLAYLISTS_REMOVED'),
                    );
                } catch (error) {
                    console.error('Error removing playlists:', error);
                    this.openSettingsSnackbar(
                        this.translate.instant('SETTINGS.IMPORT_ERROR'),
                    );
                } finally {
                    this.isRemovingAllPlaylists.set(false);
                }
            },
        });
    }

    private setupSectionObserver(): void {
        if (typeof IntersectionObserver === 'undefined') {
            return;
        }

        const scrollRoot = this.getScrollRoot();
        const contentSections = Array.from(
            this.elementRef.nativeElement.querySelectorAll(
                '.settings-group[id]'
            )
        ) as HTMLElement[];
        const sections: ObservedSettingsSection[] = contentSections.map(
            (section) => ({
                id: section.id,
                element: section,
            })
        );

        if (sections.length === 0) {
            return;
        }

        this.sectionObserver?.disconnect();
        this.sectionObserver = new IntersectionObserver(
            () => {
                if (this.settingsCtx.pendingScrollTarget()) {
                    return;
                }

                const activeSection = this.resolveActiveSection(sections);
                if (activeSection) {
                    this.settingsCtx.setActiveSection(activeSection);
                }
            },
            {
                root: scrollRoot,
                threshold: [0.12, 0.24, 0.4, 0.6],
                rootMargin: '-18% 0px -52% 0px',
            }
        );

        sections.forEach((section) =>
            this.sectionObserver?.observe(section.element)
        );

        const initialSection = this.resolveActiveSection(sections);
        if (initialSection) {
            this.settingsCtx.setActiveSection(initialSection);
        }
    }

    private resolveActiveSection(
        sections: ObservedSettingsSection[]
    ): string | null {
        const scrollRoot = this.getScrollRoot();
        const rootTop = scrollRoot?.getBoundingClientRect().top ?? 0;
        const rootHeight = scrollRoot?.clientHeight ?? window.innerHeight;
        const activationLine = rootTop + Math.min(rootHeight * 0.28, 220);
        const sectionAtActivationLine = sections.find((section) => {
            const rect = section.element.getBoundingClientRect();
            return rect.top <= activationLine && rect.bottom >= activationLine;
        });

        if (sectionAtActivationLine) {
            return sectionAtActivationLine.id;
        }

        const nearestSection = sections
            .map((section) => ({
                id: section.id,
                distance: Math.abs(
                    section.element.getBoundingClientRect().top - activationLine
                ),
            }))
            .sort((a, b) => a.distance - b.distance)[0];

        return nearestSection?.id ?? null;
    }

    private getScrollRoot(): HTMLElement | null {
        return this.elementRef.nativeElement.closest(
            'main.workspace-content'
        ) as HTMLElement | null;
    }

    private schedulePendingScrollTargetClear(
        scrollRoot: HTMLElement | null
    ): void {
        const clearPendingScrollTarget = () => {
            this.cancelPendingScrollTargetClear();
            this.settingsCtx.clearPendingScrollTarget();
        };

        this.cancelPendingScrollTargetClear();
        this.pendingScrollClearTimer = window.setTimeout(
            clearPendingScrollTarget,
            SettingsComponent.PENDING_SCROLL_CLEAR_DELAY_MS
        );
        this.pendingScrollClearRoot = scrollRoot;
        this.pendingScrollEndListener = clearPendingScrollTarget;
        scrollRoot?.addEventListener?.('scrollend', clearPendingScrollTarget, {
            once: true,
        });
    }

    private cancelPendingScrollTargetClear(): void {
        if (this.pendingScrollClearTimer) {
            clearTimeout(this.pendingScrollClearTimer);
            this.pendingScrollClearTimer = null;
        }

        if (this.pendingScrollClearRoot && this.pendingScrollEndListener) {
            this.pendingScrollClearRoot.removeEventListener?.(
                'scrollend',
                this.pendingScrollEndListener
            );
        }

        this.pendingScrollClearRoot = null;
        this.pendingScrollEndListener = null;
    }

    private scrollToSection(sectionId: string): HTMLElement | null {
        const sectionElement = document.getElementById(sectionId);
        if (!sectionElement) {
            return null;
        }

        const scrollRoot = this.getScrollRoot();
        if (!scrollRoot) {
            sectionElement.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
            });
            return null;
        }

        const rootRect = scrollRoot.getBoundingClientRect();
        const sectionRect = sectionElement.getBoundingClientRect();
        const sectionTop =
            scrollRoot.scrollTop + (sectionRect.top - rootRect.top);
        const sectionBottom = sectionTop + sectionRect.height;
        const visibleTop =
            scrollRoot.scrollTop + SettingsComponent.SECTION_SCROLL_TOP_GUTTER;
        const visibleBottom =
            scrollRoot.scrollTop +
            scrollRoot.clientHeight -
            SettingsComponent.SECTION_SCROLL_BOTTOM_GUTTER;
        let nextScrollTop = scrollRoot.scrollTop;

        if (sectionTop < visibleTop) {
            nextScrollTop =
                sectionTop - SettingsComponent.SECTION_SCROLL_TOP_GUTTER;
        } else if (sectionBottom > visibleBottom) {
            nextScrollTop =
                sectionBottom -
                scrollRoot.clientHeight +
                SettingsComponent.SECTION_SCROLL_BOTTOM_GUTTER;
        }

        const maxScrollTop = Math.max(
            0,
            scrollRoot.scrollHeight - scrollRoot.clientHeight
        );

        scrollRoot.scrollTo({
            top: Math.min(Math.max(nextScrollTop, 0), maxScrollTop),
            behavior: 'smooth',
        });

        return scrollRoot;
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

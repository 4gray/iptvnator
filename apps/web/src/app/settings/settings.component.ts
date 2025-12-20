/* eslint-disable @typescript-eslint/no-base-to-string */
import { CommonModule } from '@angular/common';
import {
    Component,
    inject,
    Inject,
    Input,
    OnInit,
    Optional,
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
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { QRCodeComponent } from 'angularx-qrcode';
import { DialogService } from 'components';
import { PlaylistActions } from 'm3u-state';
import { selectIsEpgAvailable } from 'm3u-state';
import { take } from 'rxjs';
import { DataService, EpgService, PlaylistsService } from 'services';
import {
    AiProvider,
    Language,
    Playlist,
    StreamFormat,
    Theme,
    VideoPlayer,
} from 'shared-interfaces';
import { SettingsStore } from '../services/settings-store.service';
import { HeaderComponent } from '../shared/components/header/header.component';
import { SettingsService } from './../services/settings.service';

@Component({
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
    imports: [
        CommonModule,
        FormsModule,
        HeaderComponent,
        MatButtonModule,
        MatCheckboxModule,
        MatDividerModule,
        MatIconModule,
        MatInputModule,
        MatSelectModule,
        MatTooltipModule,
        ReactiveFormsModule,
        TranslateModule,
        MatDialogModule,
        QRCodeComponent,
    ],
})
export class SettingsComponent implements OnInit {
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

    @Input() isDialog = false;
    /** List with available languages as enum */
    readonly languageEnum = Language;

    /** List with allowed formats as enum */
    readonly streamFormatEnum = StreamFormat;

    /** Flag that indicates whether the app runs in electron environment */
    readonly isDesktop = !!window.electron;

    isPwa = this.dataService.getAppEnvironment() === 'pwa';

    readonly osPlayers = [
        {
            id: VideoPlayer.MPV,
            label: 'MPV Player',
        },
        {
            id: VideoPlayer.VLC,
            label: 'VLC',
        },
    ];

    /** Player options */
    readonly players = [
        {
            id: VideoPlayer.Html5Player,
            label: 'HTML5 Video Player',
        },
        {
            id: VideoPlayer.VideoJs,
            label: 'VideoJs Player',
        },
        {
            id: VideoPlayer.ArtPlayer,
            label: 'ArtPlayer',
        },
        ...(this.isDesktop ? this.osPlayers : []),
    ];

    /** Current version of the app */
    version: string;

    /** Update message to show */
    updateMessage: string;

    /** EPG availability flag */
    epgAvailable$ = this.store.select(selectIsEpgAvailable);

    /** All available visual themes */
    themeEnum = Theme;

    /** Settings form object */
    settingsForm = this.formBuilder.group({
        player: [VideoPlayer.VideoJs],
        ...(this.isDesktop ? { epgUrl: new FormArray([]) } : {}),
        streamFormat: StreamFormat.M3u8StreamFormat,
        language: Language.ENGLISH,
        showCaptions: false,
        theme: Theme.LightTheme,
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

    private settingsStore = inject(SettingsStore);

    constructor(
        @Optional() @Inject(MAT_DIALOG_DATA) data?: { isDialog: boolean }
    ) {
        this.isDialog = data?.isDialog ?? false;
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
        this.settingsService.changeTheme(this.settingsForm.value.theme);
        this.snackBar.open(
            this.translate.instant('SETTINGS.SETTINGS_SAVED'),
            null,
            {
                duration: 2000,
                horizontalPosition: 'start',
            }
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
                            this.snackBar.open(
                                this.translate.instant('SETTINGS.IMPORT_ERROR'),
                                null,
                                {
                                    duration: 2000,
                                }
                            );
                        } else {
                            this.store.dispatch(
                                PlaylistActions.addManyPlaylists({
                                    playlists: parsedPlaylists,
                                })
                            );
                        }
                    } catch (error) {
                        this.snackBar.open(
                            this.translate.instant('SETTINGS.IMPORT_ERROR'),
                            null,
                            {
                                duration: 2000,
                            }
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
            onConfirm: (): void =>
                this.store.dispatch(PlaylistActions.removeAllPlaylists()),
        });
    }
}

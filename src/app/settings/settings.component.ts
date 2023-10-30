import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import {
    FormArray,
    FormBuilder,
    FormControl,
    Validators,
} from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { take } from 'rxjs';
import * as semver from 'semver';
import {
    EPG_FORCE_FETCH,
    SET_MPV_PLAYER_PATH,
    SET_VLC_PLAYER_PATH,
} from '../../../shared/ipc-commands';
import { Playlist } from '../../../shared/playlist.interface';
import { DataService } from '../services/data.service';
import { DialogService } from '../services/dialog.service';
import { EpgService } from '../services/epg.service';
import { PlaylistsService } from '../services/playlists.service';
import { STORE_KEY } from '../shared/enums/store-keys.enum';
import { SharedModule } from '../shared/shared.module';
import * as PlaylistActions from '../state/actions';
import { selectIsEpgAvailable } from '../state/selectors';
import { SettingsService } from './../services/settings.service';
import { Language } from './language.enum';
import { Settings, VideoPlayer } from './settings.interface';
import { Theme } from './theme.enum';

@Component({
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
    standalone: true,
    imports: [CommonModule, SharedModule],
})
export class SettingsComponent implements OnInit {
    /** List with available languages as enum */
    languageEnum = Language;

    /** Flag that indicates whether the app runs in electron environment */
    isElectron = this.electronService.isElectron;

    electronPlayers = [
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
    players = [
        {
            id: VideoPlayer.Html5Player,
            label: 'HTML5 Video Player',
        },
        {
            id: VideoPlayer.VideoJs,
            label: 'VideoJs Player',
        },
        ...(this.isElectron ? this.electronPlayers : []),
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
        ...(this.isElectron ? { epgUrl: new FormArray([]) } : {}),
        language: Language.ENGLISH,
        showCaptions: false,
        theme: Theme.LightTheme,
        mpvPlayerPath: '',
        vlcPlayerPath: '',
    });

    /** Form array with epg sources */
    epgUrl = this.settingsForm.get('epgUrl') as FormArray;

    /**
     * Creates an instance of SettingsComponent and injects
     * required dependencies into the component
     */
    constructor(
        private dialogService: DialogService,
        private electronService: DataService,
        private epgService: EpgService,
        private formBuilder: FormBuilder,
        private playlistsService: PlaylistsService,
        private router: Router,
        private settingsService: SettingsService,
        private snackBar: MatSnackBar,
        private store: Store,
        private translate: TranslateService
    ) {}

    /**
     * Reads the config object from the browsers
     * storage (indexed db)
     */
    ngOnInit(): void {
        this.setSettings();
        this.checkAppVersion();
    }

    /**
     * Sets saved settings from the indexed db store
     */
    setSettings(): void {
        this.settingsService
            .getValueFromLocalStorage(STORE_KEY.Settings)
            .subscribe((settings: Settings) => {
                if (settings) {
                    this.settingsForm.setValue({
                        player: settings.player
                            ? settings.player
                            : VideoPlayer.VideoJs,
                        ...(this.isElectron ? { epgUrl: [] } : {}),
                        language: settings.language
                            ? settings.language
                            : Language.ENGLISH,
                        showCaptions: settings.showCaptions
                            ? settings.showCaptions
                            : false,
                        theme: settings.theme
                            ? settings.theme
                            : Theme.LightTheme,
                        mpvPlayerPath: settings.mpvPlayerPath,
                        vlcPlayerPath: settings.vlcPlayerPath,
                    });

                    if (this.isElectron) {
                        this.setEpgUrls(settings.epgUrl);
                    }
                }
            });
    }

    /**
     * Sets the epg urls to the form array
     * @param epgUrls urls of the EPG sources
     */
    setEpgUrls(epgUrls: string[] | string): void {
        const URL_REGEX = /^(http|https|file):\/\/[^ "]+$/;

        const urls = Array.isArray(epgUrls) ? epgUrls : [epgUrls];
        const filteredUrls = urls.filter((url) => url !== '');

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
        this.version = this.electronService.getAppVersion();
        return semver.lt(this.version, latestVersion);
    }

    /**
     * Triggers on form submit and saves the config object to
     * the indexed db store
     */
    onSubmit(): void {
        this.settingsService
            .setValueToLocalStorage(
                STORE_KEY.Settings,
                this.settingsForm.value,
                true
            )
            .pipe(take(1))
            .subscribe(() => {
                this.applyChangedSettings();
            });

        this.electronService.sendIpcEvent(
            SET_MPV_PLAYER_PATH,
            this.settingsForm.value.mpvPlayerPath
        );

        this.electronService.sendIpcEvent(
            SET_VLC_PLAYER_PATH,
            this.settingsForm.value.mpvPlayerPath
        );
    }

    /**
     * Applies the changed settings to the app
     */
    applyChangedSettings(): void {
        this.settingsForm.markAsPristine();
        // check whether the epg url was changed or not
        if (this.isElectron) {
            let epgUrls = this.settingsForm.value.epgUrl;
            if (epgUrls) {
                if (!Array.isArray(epgUrls)) {
                    epgUrls = [epgUrls];
                }
                epgUrls = epgUrls.filter((url) => url !== '');
                this.epgService.fetchEpg(epgUrls);
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
        this.router.navigateByUrl('/');
    }

    /**
     * Fetches and updates EPG from the given URL
     * @param url epg source url
     */
    refreshEpg(url: string): void {
        this.electronService.sendIpcEvent(EPG_FORCE_FETCH, url);
        this.epgService.showFetchSnackbar();
    }

    /**
     * Initializes new entry in form array for EPG URL
     */
    addEpgSource(): void {
        this.epgUrl.insert(this.epgUrl.length, new FormControl(''));
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

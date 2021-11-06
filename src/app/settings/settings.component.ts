import { TranslateService } from '@ngx-translate/core';
import { Component, OnInit } from '@angular/core';
import { FormGroup, FormBuilder } from '@angular/forms';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, Subscription } from 'rxjs';
import { STORE_KEY } from '../shared/enums/store-keys.enum';
import { Settings, VideoPlayer } from './settings.interface';
import { HttpClient } from '@angular/common/http';
import * as semver from 'semver';
import { ElectronService } from '../services/electron.service';
import { ChannelQuery } from '../state';
import { EPG_FETCH } from '../../../shared/ipc-commands';
import { Language } from './language.enum';
import { Theme } from './theme.enum';
import { SettingsService } from './../services/settings.service';
import { catchError } from 'rxjs/operators';

/** Url of the package.json file in the app repository, required to get the version of the released app */
const PACKAGE_JSON_URL =
    'https://raw.githubusercontent.com/4gray/iptvnator/master/package.json';

@Component({
    selector: 'app-settings',
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent implements OnInit {
    /** List with available languages as enum */
    languageEnum = Language;

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
    ];

    /** Settings form object */
    settingsForm: FormGroup;

    /** Current version of the app */
    version: string;

    /** Update message to show */
    updateMessage: string;

    /** EPG availability flag */
    epgAvailable$: Observable<boolean> = this.channelQuery.select(
        (store) => store.epgAvailable
    );

    /** All available visual themes */
    themeEnum = Theme;

    /**
     * Creates an instance of SettingsComponent and injects
     * required dependencies into the component
     * @param channelQuery
     * @param electronService
     * @param formBuilder
     * @param http
     * @param router
     * @param settingsService
     * @param snackBar
     * @param storage
     * @param translate
     */
    constructor(
        private channelQuery: ChannelQuery,
        private electronService: ElectronService,
        private formBuilder: FormBuilder,
        private http: HttpClient,
        private router: Router,
        private settingsService: SettingsService,
        private snackBar: MatSnackBar,
        private storage: StorageMap,
        private translate: TranslateService
    ) {
        this.settingsForm = this.formBuilder.group({
            player: [VideoPlayer.VideoJs],
            epgUrl: '',
            language: Language.ENGLISH,
            showCaptions: false,
            theme: Theme.LightTheme,
        });

        this.checkAppVersion();
    }

    /**
     * Reads the config object from the browsers
     * storage (indexed db)
     */
    ngOnInit(): void {
        this.settingsService
            .getValueFromLocalStorage(STORE_KEY.Settings)
            .subscribe((settings: Settings) => {
                if (settings) {
                    this.settingsForm.setValue({
                        player: settings.player
                            ? settings.player
                            : VideoPlayer.VideoJs,
                        epgUrl: settings.epgUrl ? settings.epgUrl : '',
                        language: settings.language
                            ? settings.language
                            : Language.ENGLISH,
                        showCaptions: settings.showCaptions
                            ? settings.showCaptions
                            : false,
                        theme: settings.theme
                            ? settings.theme
                            : Theme.LightTheme,
                    });
                }
            });
    }

    /**
     * Checks whether the latest version of the application
     * is used and updates the version message in the
     * settings UI
     */
    checkAppVersion(): void {
        this.http
            .get(PACKAGE_JSON_URL)
            .pipe(
                catchError((err) => {
                    console.error(err);
                    throw new Error(err);
                })
            )
            .subscribe((response: { version: string }) => {
                this.showVersionInformation(response.version);
            });
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
        this.storage
            .set(STORE_KEY.Settings, this.settingsForm.value)
            .subscribe(() => {
                this.settingsForm.markAsPristine();
                // check whether the epg url was changed or not
                if (this.settingsForm.value.epgUrl) {
                    this.fetchEpg();
                }
                this.translate.use(this.settingsForm.value.language);
                this.settingsService.changeTheme(this.settingsForm.value.theme);
                this.snackBar.open(
                    this.translate.instant('SETTINGS.SETTINGS_SAVED'),
                    null,
                    {
                        duration: 2000,
                    }
                );
            });
    }

    /**
     * Navigates back to the applications homepage
     */
    backToHome(): void {
        this.router.navigateByUrl('/', { skipLocationChange: true });
    }

    /**
     * Fetches and updates EPG from the given URL
     */
    fetchEpg(): void {
        this.electronService.sendIpcEvent(EPG_FETCH, {
            url: this.settingsForm.value.epgUrl,
        });
        this.snackBar.open(this.translate.instant('EPG.FETCH_EPG'), 'Close', {
            verticalPosition: 'bottom',
            horizontalPosition: 'right',
        });
    }
}

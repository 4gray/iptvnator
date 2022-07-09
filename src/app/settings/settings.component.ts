import { HttpClient } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import {
    FormArray,
    FormBuilder,
    FormControl,
    Validators,
} from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as semver from 'semver';
import { DataService } from '../services/data.service';
import { EpgService } from '../services/epg.service';
import { STORE_KEY } from '../shared/enums/store-keys.enum';
import { ChannelQuery } from '../state';
import { SettingsService } from './../services/settings.service';
import { Language } from './language.enum';
import { Settings, VideoPlayer } from './settings.interface';
import { Theme } from './theme.enum';

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
    settingsForm = this.formBuilder.group({
        player: [VideoPlayer.VideoJs],
        epgUrl: new FormArray([]),
        language: Language.ENGLISH,
        showCaptions: false,
        theme: Theme.LightTheme,
    });

    /** Current version of the app */
    version: string;

    /** Update message to show */
    updateMessage: string;

    /** EPG availability flag */
    epgAvailable$: Observable<boolean> = this.channelQuery.select(
        (store) => store.epgAvailable
    );

    /** Flag that indicates whether the app runs in electron environment */
    isElectron = this.electronService.isElectron;

    /** All available visual themes */
    themeEnum = Theme;

    /** Form array with epg sources */
    epgUrl = this.settingsForm.get('epgUrl') as FormArray;

    /**
     * Creates an instance of SettingsComponent and injects
     * required dependencies into the component
     */
    constructor(
        private channelQuery: ChannelQuery,
        private electronService: DataService,
        private epgService: EpgService,
        private formBuilder: FormBuilder,
        private http: HttpClient,
        private router: Router,
        private settingsService: SettingsService,
        private snackBar: MatSnackBar,
        private storage: StorageMap,
        private translate: TranslateService
    ) {}

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
                        epgUrl: [],
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

                    this.setEpgUrls(settings.epgUrl);
                }
            });

        this.checkAppVersion();
    }

    /**
     * Sets the epg urls to the form array
     * @param epgUrls urls of the EPG sources
     */
    setEpgUrls(epgUrls: string[] | string): void {
        const URL_REGEX = /^(http|https):\/\/[^ "]+$/;

        if (!Array.isArray(epgUrls)) {
            epgUrls = [epgUrls];
        }

        for (const url of epgUrls) {
            this.epgUrl.push(
                new FormControl(url, [
                    Validators.required,
                    Validators.pattern(URL_REGEX),
                ])
            );
        }
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
                    this.fetchEpg(this.settingsForm.value.epgUrl);
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
        this.router.navigateByUrl('/');
    }

    /**
     * Fetches and updates EPG from the given URL
     * @param urls epg source urls
     */
    fetchEpg(urls: string | string[]): void {
        this.epgService.fetchEpg(urls);
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
}

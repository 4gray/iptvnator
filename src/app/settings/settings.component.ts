import { Component, OnInit } from '@angular/core';
import {
    UntypedFormArray,
    UntypedFormBuilder,
    UntypedFormControl,
    Validators,
} from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import * as semver from 'semver';
import { DataService } from '../services/data.service';
import { EpgService } from '../services/epg.service';
import { STORE_KEY } from '../shared/enums/store-keys.enum';
import { ChannelQuery } from '../state';
import { SettingsService } from './../services/settings.service';
import { Language } from './language.enum';
import { Settings, VideoPlayer } from './settings.interface';
import { Theme } from './theme.enum';

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

    /** Settings form object */
    settingsForm = this.formBuilder.group({
        player: [VideoPlayer.VideoJs],
        ...(this.isElectron ? { epgUrl: new UntypedFormArray([]) } : {}),
        language: Language.ENGLISH,
        showCaptions: false,
        theme: Theme.LightTheme,
    });

    /** Form array with epg sources */
    epgUrl = this.settingsForm.get('epgUrl') as UntypedFormArray;

    /**
     * Creates an instance of SettingsComponent and injects
     * required dependencies into the component
     */
    constructor(
        private channelQuery: ChannelQuery,
        private electronService: DataService,
        private epgService: EpgService,
        private formBuilder: UntypedFormBuilder,
        private router: Router,
        private settingsService: SettingsService,
        private snackBar: MatSnackBar,
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

        if (!Array.isArray(epgUrls)) {
            epgUrls = [epgUrls];
        }

        for (const url of epgUrls) {
            this.epgUrl.push(
                new UntypedFormControl(url, [Validators.pattern(URL_REGEX)])
            );
        }
    }

    /**
     * Checks whether the latest version of the application
     * is used and updates the version message in the
     * settings UI
     */
    checkAppVersion(): void {
        this.settingsService.getAppVersion().subscribe((version) => {
            this.showVersionInformation(version);
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
        this.settingsService
            .setValueToLocalStorage(
                STORE_KEY.Settings,
                this.settingsForm.value,
                true
            )
            .subscribe(() => {
                this.applyChangedSettings();
            });
    }

    /**
     * Applies the changed settings to the app
     */
    applyChangedSettings(): void {
        this.settingsForm.markAsPristine();
        // check whether the epg url was changed or not
        if (this.isElectron) {
            if (this.settingsForm.value.epgUrl) {
                this.fetchEpg(this.settingsForm.value.epgUrl);
            }
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
        this.epgUrl.insert(this.epgUrl.length, new UntypedFormControl(''));
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

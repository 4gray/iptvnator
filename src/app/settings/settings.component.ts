import { TranslateService } from '@ngx-translate/core';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormGroup, FormBuilder } from '@angular/forms';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, Subscription } from 'rxjs';
import { Settings, VideoPlayer } from './settings.interface';
import { HttpClient } from '@angular/common/http';
import * as semver from 'semver';
import { ElectronService } from '../services/electron.service';
import { ChannelQuery } from '../state';
import { EPG_FETCH } from '../../../shared/ipc-commands';
import { Language } from './language.enum';
import { Theme } from './theme.enum';
import { SettingsService } from './../services/settings.service';

/** Url of the package.json file in the app repository, required to get the version of the released app */
const PACKAGE_JSON_URL =
    'https://raw.githubusercontent.com/4gray/iptvnator/master/package.json';

@Component({
    selector: 'app-settings',
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent implements OnInit, OnDestroy {
    /** Subscription object */
    private subscription: Subscription = new Subscription();

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
     * Creates an instance of SettingsComponent and injects some dependencies into the component
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

        this.subscription.add(
            this.http
                .get(PACKAGE_JSON_URL)
                .subscribe((response: { version: string }) => {
                    this.version = this.electronService.getAppVersion();
                    const isOutdated = semver.lt(
                        this.version,
                        response.version
                    );

                    if (isOutdated) {
                        this.updateMessage = `${
                            this.translate.instant(
                                'SETTINGS.NEW_VERSION_AVAILABLE'
                            ) as string
                        }: ${response.version}`;
                    } else {
                        this.updateMessage = this.translate.instant(
                            'SETTINGS.LATEST_VERSION'
                        );
                    }
                })
        );
    }

    /**
     * Reads the config object from the browsers storage (indexed db)
     */
    ngOnInit(): void {
        this.subscription.add(
            this.storage.get('settings').subscribe((settings: Settings) => {
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
            })
        );
    }

    /**
     * Triggers on form submit and saves the config object to the indexed db store
     */
    onSubmit(): void {
        this.subscription.add(
            this.storage
                .set('settings', this.settingsForm.value)
                .subscribe(() => {
                    this.settingsForm.markAsPristine();
                    // check whether the epg url was changed or not
                    if (this.settingsForm.value.epgUrl) {
                        this.fetchEpg();
                    }
                    this.translate.use(this.settingsForm.value.language);
                    this.settingsService.changeTheme(
                        this.settingsForm.value.theme
                    );
                    this.snackBar.open(
                        this.translate.instant('SETTINGS.SETTINGS_SAVED'),
                        null,
                        {
                            duration: 2000,
                        }
                    );
                })
        );
    }

    /**
     * Navigates back to the applications homepage
     */
    backToHome(): void {
        this.router.navigateByUrl('/', { skipLocationChange: true });
    }

    /**
     * Unsubscribe on destroy
     */
    ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    /**
     * Fetches and updates EPG from the given URL
     */
    fetchEpg(): void {
        this.electronService.ipcRenderer.send(EPG_FETCH, {
            url: this.settingsForm.value.epgUrl,
        });
        this.snackBar.open(this.translate.instant('EPG.FETCH_EPG'), 'Close', {
            verticalPosition: 'bottom',
            horizontalPosition: 'right',
        });
    }
}

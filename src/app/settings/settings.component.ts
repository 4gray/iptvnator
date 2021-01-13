import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormGroup, FormBuilder } from '@angular/forms';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, Subscription } from 'rxjs';
import { Settings } from './settings.interface';
import { HttpClient } from '@angular/common/http';
import * as semver from 'semver';
import { ElectronService } from 'app/services/electron.service';
import { ChannelQuery } from 'app/state';
import { EPG_FETCH } from 'app/shared/ipc-commands';

@Component({
    selector: 'app-settings',
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent implements OnInit, OnDestroy {
    /** Subscription object */
    private subscription: Subscription = new Subscription();

    /** Url of the package.json file in the app repository, required to get the version of the released app */
    latestPackageJsonUrl =
        'https://raw.githubusercontent.com/4gray/iptvnator/master/package.json';

    /** Player options */
    players = [
        {
            id: 'html5',
            label: ' HTML5 Video Player',
        },
        {
            id: 'videojs',
            label: ' VideoJs Player',
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

    /**
     * Creates an instance of SettingsComponent and injects some dependencies into the component
     * @param channelQuery
     * @param electronService
     * @param formBuilder
     * @param http
     * @param router
     * @param snackBar
     * @param storage
     */
    constructor(
        private channelQuery: ChannelQuery,
        private electronService: ElectronService,
        private formBuilder: FormBuilder,
        private http: HttpClient,
        private router: Router,
        private snackBar: MatSnackBar,
        private storage: StorageMap
    ) {
        this.settingsForm = this.formBuilder.group({
            player: ['html5'], // default value
            epgUrl: '',
        });

        this.subscription.add(
            this.http
                .get(this.latestPackageJsonUrl)
                .subscribe((response: { version: string }) => {
                    this.version = this.electronService.getAppVersion();
                    const isOutdated = semver.lt(
                        this.version,
                        response.version
                    );

                    if (isOutdated) {
                        this.updateMessage = `There is a new version available: ${response.version}`;
                    } else {
                        this.updateMessage = 'You are using the latest version';
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
                        player: settings.player ? settings.player : 'html5',
                        epgUrl: settings.epgUrl ? settings.epgUrl : '',
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
                    this.snackBar.open(
                        'Success! Configuration was saved.',
                        null,
                        {
                            duration: 2000,
                        }
                    );
                    // check whether the epg url was changed or not
                    if (this.settingsForm.value.epgUrl) {
                        this.fetchEpg();
                    }
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
        this.snackBar.open('Fetch EPG data...', 'Close', {
            verticalPosition: 'bottom',
            horizontalPosition: 'right',
        });
    }
}

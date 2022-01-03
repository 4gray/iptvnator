import { Component, NgZone } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { ChannelStore } from './state';
import { Settings } from './settings/settings.interface';
import {
    EPG_ERROR,
    EPG_FETCH,
    EPG_FETCH_DONE,
    OPEN_FILE,
    SHOW_WHATS_NEW,
    VIEW_ADD_PLAYLIST,
    VIEW_SETTINGS,
} from '../../shared/ipc-commands';
import { IpcCommand } from '../../shared/ipc-command.class';
import { SettingsService } from './services/settings.service';
import { WhatsNewService } from './services/whats-new.service';
import * as semver from 'semver';
import { ModalWindow } from 'ngx-whats-new/lib/modal-window.interface';
import { STORE_KEY } from './shared/enums/store-keys.enum';
import { DataService } from './services/data.service';

/**
 * AppComponent
 */
@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
})
export class AppComponent {
    /** Visibility flag of the "what is new" modal dialog */
    isDialogVisible$ = this.whatsNewService.dialogState$;

    /** Dialog options */
    options = this.whatsNewService.options;

    /** Modals to show for the updated version of the application */
    modals: ModalWindow[] = [];

    /** Default options for epg snackbar notifications */
    epgSnackBarOptions: MatSnackBarConfig = {
        verticalPosition: 'bottom',
        horizontalPosition: 'right',
    };

    /** List of ipc commands with function mapping */
    commandsList = [
        new IpcCommand(VIEW_ADD_PLAYLIST, () => this.navigateToRoute('/')),
        new IpcCommand(VIEW_SETTINGS, () => this.navigateToRoute('/settings')),
        new IpcCommand(EPG_FETCH_DONE, () => this.onEpgFetchDone),
        new IpcCommand(EPG_ERROR, () => this.onEpgError),
        new IpcCommand(SHOW_WHATS_NEW, () => this.showWhatsNewDialog),
    ];

    /** Default language as fallback */
    DEFAULT_LANG = 'en';

    /**
     * Creates an instance of AppComponent
     */
    constructor(
        private channelStore: ChannelStore,
        private electronService: DataService,
        private ngZone: NgZone,
        private router: Router,
        private translate: TranslateService,
        private settingsService: SettingsService,
        private snackBar: MatSnackBar,
        private whatsNewService: WhatsNewService
    ) {
        if (
            ((this.electronService.isElectron &&
                this.electronService?.remote?.process.platform === 'linux') ||
                this.electronService?.remote?.process.platform === 'win32') &&
            this.electronService.remote.process.argv.length > 2
        ) {
            const filePath = this.electronService.remote.process.argv.find(
                (filepath) =>
                    filepath.endsWith('.m3u') || filepath.endsWith('.m3u8')
            );
            if (filePath) {
                const filePathsArray = filePath.split('/');
                const fileName = filePathsArray[filePathsArray.length - 1];
                this.electronService.sendIpcEvent(OPEN_FILE, {
                    filePath,
                    fileName,
                });
            }
        }
    }

    /**
     * Starts all the functions to initialize the component
     */
    ngOnInit(): void {
        this.translate.setDefaultLang(this.DEFAULT_LANG);

        this.setRendererListeners();
        this.initSettings();
        this.handleWhatsNewDialog();
    }

    /**
     * Initializes all necessary listeners for the events from the renderer process
     */
    setRendererListeners(): void {
        if (this.electronService.isElectron) {
            this.commandsList.forEach((command) =>
                this.electronService.listenOn(command.id, () =>
                    this.ngZone.run(() => command.callback())
                )
            );
        }
    }

    /**
     * Reads the settings object from local storage and initializes the
     * application based on them
     */
    initSettings(): void {
        this.settingsService
            .getValueFromLocalStorage(STORE_KEY.Settings)
            .subscribe((settings: Settings) => {
                if (settings && Object.keys(settings).length > 0) {
                    this.translate.use(settings.language ?? this.DEFAULT_LANG);
                    if (settings.epgUrl) {
                        this.electronService.sendIpcEvent(EPG_FETCH, {
                            url: settings.epgUrl,
                        });
                        this.snackBar.open(
                            this.translate.instant('EPG.FETCH_EPG'),
                            this.translate.instant('CLOSE'),
                            this.epgSnackBarOptions
                        );
                    }

                    if (settings.theme) {
                        this.settingsService.changeTheme(settings.theme);
                    }
                }
            });
    }

    /**
     * Checks the actual version of the application and shows the "what is new" dialog if the updated version was detected
     */
    handleWhatsNewDialog(): void {
        const actualVersion = this.electronService.getAppVersion();
        this.settingsService
            .getValueFromLocalStorage(STORE_KEY.Version)
            .subscribe((version) => {
                const isNewVersion = semver.gt(
                    actualVersion,
                    version || '0.0.0'
                );
                if (!version || isNewVersion) {
                    this.modals =
                        this.whatsNewService.getModalsByVersion(actualVersion);
                    this.setDialogVisibility(true);
                }
                this.settingsService.setValueToLocalStorage(
                    STORE_KEY.Version,
                    actualVersion
                );
            });
    }

    /**
     * Sets the visibility flag of the modal window
     * @param visible show/hide window flag
     */
    setDialogVisibility(visible: boolean): void {
        if (this.modals.length > 0) {
            this.whatsNewService.changeDialogVisibleState(visible);
        }
    }

    /**
     * Navigate to the specified route
     * @param route route to navigate to
     */
    navigateToRoute(route: string) {
        this.router.navigateByUrl(route, { skipLocationChange: true });
    }

    /**
     * Handles the event when the EPG fetching is done
     */
    onEpgFetchDone(): void {
        this.channelStore.setEpgAvailableFlag(true);
        this.snackBar.open(
            this.translate.instant('EPG.DOWNLOAD_SUCCESS'),
            null,
            {
                ...this.epgSnackBarOptions,
                duration: 2000,
            }
        );
    }

    /**
     * Handles epg error
     */
    onEpgError(): void {
        this.snackBar.open(this.translate.instant('EPG.ERROR'), null, {
            ...this.epgSnackBarOptions,
            duration: 2000,
        });
    }

    /**
     * Shows the "what is new" dialog
     */
    showWhatsNewDialog(): void {
        this.modals = this.whatsNewService.getModalsByVersion(
            this.electronService.getAppVersion()
        );
        this.setDialogVisibility(true);
    }

    /**
     * Removes all ipc command listeners on component destroy
     */
    ngOnDestroy(): void {
        this.electronService.removeAllListeners(EPG_FETCH_DONE);
        this.electronService.removeAllListeners(EPG_ERROR);
        this.electronService.removeAllListeners(VIEW_ADD_PLAYLIST);
        this.electronService.removeAllListeners(VIEW_SETTINGS);
    }
}

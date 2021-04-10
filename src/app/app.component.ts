import { Component, NgZone } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Titlebar, Color } from 'custom-electron-titlebar';
import { ElectronService } from './services/electron.service';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChannelStore } from './state';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Settings } from './settings/settings.interface';
import {
    EPG_ERROR,
    EPG_FETCH,
    EPG_FETCH_DONE,
    SHOW_WHATS_NEW,
} from '../../ipc-commands';
import { SettingsService } from './services/settings.service';
import { WhatsNewService } from './services/whats-new.service';
import * as semver from 'semver';
import { ModalWindow } from 'ngx-whats-new/lib/modal-window.interface';

// create custom title bar
new Titlebar({
    backgroundColor: Color.fromHex('#000'),
    itemBackgroundColor: Color.fromHex('#222'),
    enableMnemonics: true,
});

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
})
export class AppComponent {
    /** Visibility flag of the "what is new" modal dialog */
    isDialogVisible$ = this.whatsNewService.dialogState$;
    /** Dialog options */
    options = this.whatsNewService.options;
    /** Modals to show for the updated version of the application */
    modals: ModalWindow[];

    /**
     * Creates an instance of AppComponent
     */
    constructor(
        private channelStore: ChannelStore,
        private electronService: ElectronService,
        private ngZone: NgZone,
        private router: Router,
        private translate: TranslateService,
        private settingsService: SettingsService,
        private snackBar: MatSnackBar,
        private storage: StorageMap,
        private whatsNewService: WhatsNewService
    ) {
        this.translate.setDefaultLang('en');

        this.setRendererListeners();

        if (
            (this.electronService.remote.process.platform === 'linux' ||
                this.electronService.remote.process.platform === 'win32') &&
            this.electronService.remote.process.argv.length > 2
        ) {
            const filePath = this.electronService.remote.process.argv.find(
                (filepath) =>
                    filepath.endsWith('.m3u') || filepath.endsWith('.m3u8')
            );
            if (filePath) {
                const filePathsArray = filePath.split('/');
                const fileName = filePathsArray[filePathsArray.length - 1];
                this.electronService.ipcRenderer.send('open-file', {
                    filePath,
                    fileName,
                });
            }
        }
    }

    /**
     * Initializes all necessary listeners for the events from the renderer process
     */
    setRendererListeners(): void {
        this.electronService.ipcRenderer.on('add-playlist-view', () => {
            this.ngZone.run(() => {
                this.router.navigateByUrl('/', { skipLocationChange: true });
            });
        });

        this.electronService.ipcRenderer.on('settings-view', () => {
            this.ngZone.run(() => {
                this.router.navigateByUrl('/settings', {
                    skipLocationChange: true,
                });
            });
        });

        this.electronService.ipcRenderer.on(EPG_FETCH_DONE, () => {
            this.ngZone.run(() => {
                this.channelStore.setEpgAvailableFlag(true);
                this.snackBar.open('EPG was successfully downloaded!', null, {
                    duration: 2000,
                    verticalPosition: 'bottom',
                    horizontalPosition: 'right',
                });
            });
        });

        this.electronService.ipcRenderer.on(EPG_ERROR, () => {
            this.snackBar.open('EPG Error: something went wrong...', null, {
                duration: 2000,
                verticalPosition: 'bottom',
                horizontalPosition: 'right',
            });
        });

        this.electronService.ipcRenderer.on(SHOW_WHATS_NEW, () => {
            this.ngZone.run(() => {
                this.modals = this.whatsNewService.getModalsByVersion(
                    this.electronService.getAppVersion()
                );
                this.setDialogVisibility(true);
            });
        });
    }

    /**
     * Subscribes for app settings on component init
     */
    ngOnInit(): void {
        this.storage.get('settings').subscribe((settings: Settings) => {
            if (settings && Object.keys(settings).length > 0) {
                this.translate.use(settings.language ?? 'en');
                if (settings.epgUrl) {
                    this.electronService.ipcRenderer.send(EPG_FETCH, {
                        url: settings.epgUrl,
                    });
                    this.snackBar.open('Fetch EPG data...', 'Close', {
                        verticalPosition: 'bottom',
                        horizontalPosition: 'right',
                    });
                }

                if (settings.theme) {
                    this.settingsService.changeTheme(settings.theme);
                }
            }
        });

        this.handleWhatsNewDialog();
    }

    /**
     * Checks the actual version of the application and shows the "what is new" dialog if the updated version was detected
     */
    handleWhatsNewDialog(): void {
        const actualVersion = this.electronService.getAppVersion();
        this.storage.get('version').subscribe((version) => {
            const isNewVersion = semver.gt(actualVersion, version || '0.0.0');
            if (!version || isNewVersion) {
                this.modals = this.whatsNewService.getModalsByVersion(
                    actualVersion
                );
                this.setDialogVisibility(true);
            }
            this.setVersion(actualVersion);
        });
    }

    /**
     * Updates the version of the application in localstorage
     * @param version actual version of the application
     */
    setVersion(version: string): void {
        this.storage.set('version', version).subscribe(() => {});
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
     * Removes all ipc command listeners on component destroy
     */
    ngOnDestroy(): void {
        this.electronService.ipcRenderer.removeAllListeners(EPG_FETCH_DONE);
        this.electronService.ipcRenderer.removeAllListeners(EPG_ERROR);
        this.electronService.ipcRenderer.removeAllListeners(
            'add-playlist-view'
        );
        this.electronService.ipcRenderer.removeAllListeners('settings-view');
    }
}

import { Component, NgZone } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Titlebar, Color } from 'custom-electron-titlebar';
import { ElectronService } from './services/electron.service';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChannelStore } from './state';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Settings } from './settings/settings.interface';
import { EPG_ERROR, EPG_FETCH, EPG_FETCH_DONE } from '../../ipc-commands';

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
    constructor(
        private channelStore: ChannelStore,
        private electronService: ElectronService,
        private ngZone: NgZone,
        private router: Router,
        private translate: TranslateService,
        private snackBar: MatSnackBar,
        private storage: StorageMap
    ) {
        this.translate.setDefaultLang('en');

        if (electronService.isElectron) {
            console.log(process.env);
            console.log('Run in electron');
            console.log(
                'Electron ipcRenderer',
                this.electronService.ipcRenderer
            );
            console.log(
                'NodeJS childProcess',
                this.electronService.childProcess
            );
        } else {
            console.log('Run in browser');
        }
        this.electronService.ipcRenderer.on('add-playlist-view', () => {
            this.ngZone.run(() => {
                this.router.navigateByUrl('/', { skipLocationChange: true });
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
     * Subscribes for app settings on component init
     */
    ngOnInit(): void {
        this.storage.get('settings').subscribe((settings: Settings) => {
            if (
                settings &&
                Object.keys(settings).length > 0 &&
                settings.epgUrl
            ) {
                this.translate.setDefaultLang(settings.language ?? 'en');
                this.electronService.ipcRenderer.send(EPG_FETCH, {
                    url: settings.epgUrl,
                });
                this.snackBar.open('Fetch EPG data...', 'Close', {
                    verticalPosition: 'bottom',
                    horizontalPosition: 'right',
                });
            }
        });
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
    }
}

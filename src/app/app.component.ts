import { Component, NgZone } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AppConfig } from '../environments/environment';
import { akitaDevtools } from '@datorama/akita';
import { Titlebar, Color } from 'custom-electron-titlebar';
import { ElectronService } from './services/electron.service';
import { Router } from '@angular/router';

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
        private electronService: ElectronService,
        private ngZone: NgZone,
        private router: Router,
        private translate: TranslateService
    ) {
        if (!AppConfig.production) {
            akitaDevtools(ngZone);
        }
        this.translate.setDefaultLang('en');
        console.log('AppConfig', AppConfig);

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
    }
}

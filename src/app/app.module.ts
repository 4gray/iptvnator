import 'reflect-metadata';
import '../polyfills';

import { AppRoutingModule } from './app-routing.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { NgxWhatsNewModule } from 'ngx-whats-new';
import { SharedModule } from './shared/shared.module';

// NG Translate
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';

import { AppComponent } from './app.component';
import { ElectronService } from './services/electron.service';
import { PwaService } from './services/pwa.service';
import { DataService } from './services/data.service';
import { NgxIndexedDBModule, NgxIndexedDBService } from 'ngx-indexed-db';
import { AppConfig } from '../environments/environment';
import { dbConfig } from './indexed-db.config';
import { ServiceWorkerModule } from '@angular/service-worker';

// AoT requires an exported function for factories
export function HttpLoaderFactory(http: HttpClient): TranslateHttpLoader {
    return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

/**
 * Returns true if the application runs in the electron based environment.
 */
function isElectron() {
    return !!(window && window.process && (window.process as any).type);
}

/**
 * Conditionally imports the necessary service based on the current environment
 * @param dbService indexed db service
 * @returns
 */
export function DataFactory(dbService: NgxIndexedDBService, http: HttpClient) {
    if (isElectron()) {
        return new ElectronService();
    }
    return new PwaService(dbService, http);
}

@NgModule({
    declarations: [AppComponent],
    imports: [
        AppRoutingModule,
        BrowserAnimationsModule,
        BrowserModule,
        HttpClientModule,
        NgxWhatsNewModule,
        SharedModule,
        AppConfig.environment === 'WEB'
            ? NgxIndexedDBModule.forRoot(dbConfig)
            : [],
        NgxIndexedDBModule.forRoot(dbConfig),
        TranslateModule.forRoot({
            loader: {
                provide: TranslateLoader,
                useFactory: HttpLoaderFactory,
                deps: [HttpClient],
            },
        }),
        ServiceWorkerModule.register('ngsw-worker.js', {
            enabled: AppConfig.production,
            // Register the ServiceWorker as soon as the app is stable
            // or after 30 seconds (whichever comes first).
            registrationStrategy: 'registerWhenStable:30000',
        }),
    ],
    providers: [
        {
            provide: DataService,
            useFactory: DataFactory,
            deps: [NgxIndexedDBService, HttpClient],
        },
    ],
    bootstrap: [AppComponent],
})
export class AppModule {}

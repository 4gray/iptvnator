import { HttpClient, HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ServiceWorkerModule } from '@angular/service-worker';
// NG Translate
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { NgxIndexedDBModule, NgxIndexedDBService } from 'ngx-indexed-db';
import 'reflect-metadata';
import { AppConfig } from '../environments/environment';
import '../polyfills';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { dbConfig } from './indexed-db.config';
import { DataService } from './services/data.service';
import { ElectronService } from './services/electron.service';
import { PwaService } from './services/pwa.service';
import { SharedModule } from './shared/shared.module';

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
            enabled: AppConfig.production && !isElectron(),
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

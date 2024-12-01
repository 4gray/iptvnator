import {
    HttpClient,
    provideHttpClient,
    withInterceptorsFromDi,
} from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ServiceWorkerModule } from '@angular/service-worker';
import { EffectsModule } from '@ngrx/effects';
import { StoreRouterConnectingModule, routerReducer } from '@ngrx/router-store';
import { StoreModule } from '@ngrx/store';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { NgxIndexedDBModule, NgxIndexedDBService } from 'ngx-indexed-db';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import { NgxWhatsNewModule } from 'ngx-whats-new';
import 'reflect-metadata';
import { AppConfig } from '../environments/environment';
import '../polyfills';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { dbConfig } from './indexed-db.config';
import { DataService } from './services/data.service';
import { PwaService } from './services/pwa.service';
import { TauriService } from './services/tauri.service';
import { PlaylistEffects } from './state/effects';
import { playlistReducer } from './state/reducers';

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

function isTauri() {
    return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

/**
 * Conditionally imports the necessary service based on the current environment
 */
export function DataFactory() {
    if (isTauri()) {
        return new TauriService();
    }
    return new PwaService();
}

@NgModule({
    declarations: [AppComponent],
    bootstrap: [AppComponent],
    imports: [
        AppRoutingModule,
        BrowserAnimationsModule,
        BrowserModule,
        AppConfig.environment === 'WEB'
            ? NgxIndexedDBModule.forRoot(dbConfig)
            : [],
        NgxWhatsNewModule,
        NgxIndexedDBModule.forRoot(dbConfig),
        NgxSkeletonLoaderModule.forRoot({
            animation: 'pulse',
            loadingText: 'This item is actually loading...',
        }),
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
        StoreModule.forRoot({
            router: routerReducer,
        }),
        StoreRouterConnectingModule.forRoot(),
        StoreModule.forFeature('playlistState', playlistReducer),
        EffectsModule.forRoot([PlaylistEffects]),
        StoreDevtoolsModule.instrument({
            maxAge: 25,
            logOnly: AppConfig.production,
        }),
    ],
    providers: [
        {
            provide: DataService,
            useFactory: DataFactory,
            deps: [NgxIndexedDBService, HttpClient],
        },
        provideHttpClient(withInterceptorsFromDi()),
    ],
})
export class AppModule {}

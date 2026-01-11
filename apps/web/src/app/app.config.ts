import {
    HttpClient,
    provideHttpClient,
    withInterceptorsFromDi,
} from '@angular/common/http';
import {
    ApplicationConfig,
    importProvidersFrom,
    provideZoneChangeDetection,
} from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideEffects } from '@ngrx/effects';
import { provideRouterStore, routerReducer } from '@ngrx/router-store';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { PlaylistEffects, playlistReducer } from 'm3u-state';
import { NgxIndexedDBModule, NgxIndexedDBService } from 'ngx-indexed-db';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import { DataService } from 'services';
import { dbConfig } from 'shared-interfaces';
import { AppConfig } from '../environments/environment';
import { routes } from './app.routes';
import { ElectronService } from './services/electron.service';
import { PwaService } from './services/pwa.service';
import { provideXtreamDataSource } from './xtream-tauri/data-sources';

// AoT requires an exported function for factories
export function HttpLoaderFactory(http: HttpClient): TranslateHttpLoader {
    return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

/**
 * Conditionally provides the necessary service based on the current environment
 */
export function DataFactory() {
    if (window.electron) {
        return new ElectronService();
    }
    return new PwaService();
}

export const appConfig: ApplicationConfig = {
    providers: [
        provideZoneChangeDetection({ eventCoalescing: true }),
        provideRouter(routes),
        provideAnimations(),
        provideHttpClient(withInterceptorsFromDi()),
        provideStore({
            router: routerReducer,
            playlistState: playlistReducer,
        }),
        provideEffects([PlaylistEffects]),
        provideRouterStore(),
        provideStoreDevtools({
            maxAge: 25,
            logOnly: AppConfig.production,
        }),
        provideServiceWorker('ngsw-worker.js', {
            enabled: AppConfig.production && !!window.electron,
            registrationStrategy: 'registerWhenStable:30000',
        }),
        importProvidersFrom(
            AppConfig.environment === 'WEB'
                ? NgxIndexedDBModule.forRoot(dbConfig)
                : [],
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
            })
        ),
        {
            provide: DataService,
            useFactory: DataFactory,
            deps: [NgxIndexedDBService, HttpClient],
        },
        ...provideXtreamDataSource(),
    ],
};

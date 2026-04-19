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
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withComponentInputBinding } from '@angular/router';
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
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { PLAYLIST_PLAYER_ACTIONS } from '@iptvnator/playlist/shared/util';
import { provideXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import { DataService } from 'services';
import { dbConfig } from 'shared-interfaces';
import { AppConfig } from '../environments/environment';
import { routes } from './app.routes';
import { ElectronService } from './services/electron.service';
import { ExternalPlaybackService } from './services/external-playback.service';
import { PlayerService } from './services/player.service';
import {
    AppPortalNavigationActionsService,
    providePortalNavigationActions,
} from './services/portal-navigation-actions.service';
import { providePortalPlaybackPositions } from './services/portal-playback-positions.service';
import { PwaService } from './services/pwa.service';
import { provideWorkspaceShellActions } from './services/workspace-shell-actions.service';

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
        provideRouter(routes, withComponentInputBinding()),
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
        {
            provide: PORTAL_PLAYER,
            useExisting: PlayerService,
        },
        {
            provide: PORTAL_EXTERNAL_PLAYBACK,
            useExisting: ExternalPlaybackService,
        },
        ...providePortalPlaybackPositions(),
        ...providePortalNavigationActions(),
        {
            provide: PLAYLIST_PLAYER_ACTIONS,
            useExisting: AppPortalNavigationActionsService,
        },
        ...provideWorkspaceShellActions(),
        ...provideXtreamDataSource(),
        {
            provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
            useValue: { appearance: 'outline', subscriptSizing: 'dynamic' },
        },
    ],
};

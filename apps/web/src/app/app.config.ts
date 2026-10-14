import {
    HttpClient,
    provideHttpClient,
    withInterceptorsFromDi,
    withXhr,
} from '@angular/common/http';
import {
    FullscreenOverlayContainer,
    OverlayContainer,
} from '@angular/cdk/overlay';
import {
    ApplicationConfig,
    inject,
    importProvidersFrom,
    provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideEffects } from '@ngrx/effects';
import { provideRouterStore, routerReducer } from '@ngrx/router-store';
import { provideStore } from '@ngrx/store';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { PlaylistEffects, playlistReducer } from '@iptvnator/m3u-state';
import { NgxIndexedDBModule } from 'ngx-indexed-db';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util/tokens';
import { STALKER_PLAYLIST_CONNECTION_EDITOR } from '@iptvnator/playlist/shared/ui/stalker-connection-editor';
import { provideXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import {
    provideParentalLockPlaylistCleanup,
    DataService,
} from '@iptvnator/services';
import { dbConfig } from '@iptvnator/shared/interfaces';
import { storeDevtoolsProviders } from '../environments/store-devtools.providers';
import { routes } from './app.routes';
import { ElectronService } from './services/electron.service';
import { ExternalPlaybackService } from './services/external-playback.service';
import { PlayerService } from './services/player.service';
import { provideParentalLockPrompt } from './services/parental-lock-prompt.service';
import { providePortalPlaybackPositions } from './services/portal-playback-positions.service';
import { PwaService } from './services/pwa.service';
import { shouldEnableServiceWorker } from './services/runtime-config';
import { LazyStalkerPlaylistConnectionEditor } from './services/lazy-stalker-playlist-connection-editor';
import { provideWorkspaceShellActions } from './services/workspace-shell-actions.service';

// AoT requires an exported function for factories
export function HttpLoaderFactory(http: HttpClient): TranslateHttpLoader {
    return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

/**
 * Synchronously read the user's preferred language from localStorage so the
 * very first render uses the right locale instead of flashing English first
 * and re-rendering once the IDB-backed settings finish loading.
 *
 * The hint is written by AppComponent.initSettings() whenever the saved
 * settings resolve, so first-ever boots fall back to English (no hint
 * present yet) and every subsequent boot uses the saved language.
 */
const SUPPORTED_LANGS = new Set([
    'ar',
    'ary',
    'by',
    'de',
    'el',
    'en',
    'es',
    'fr',
    'hu',
    'it',
    'ja',
    'ko',
    'nl',
    'pl',
    'pt',
    'ru',
    'tr',
    'zh',
    'zhtw',
]);
export const PREFERRED_LANGUAGE_STORAGE_KEY = 'iptvnator:preferred-language';
export function getInitialLanguage(): string {
    try {
        const saved = localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY);
        if (saved && SUPPORTED_LANGS.has(saved)) {
            return saved;
        }
    } catch {
        // localStorage may throw in privacy modes; fall through to default.
    }
    return 'en';
}

/**
 * Conditionally provides the necessary service based on the current environment
 */
export function DataFactory() {
    if (window.electron) {
        return inject(ElectronService);
    }
    return inject(PwaService);
}

export const appConfig: ApplicationConfig = {
    providers: [
        provideZonelessChangeDetection(),
        provideRouter(routes, withComponentInputBinding()),
        // No provideAnimations(): nothing declares an Angular animation
        // trigger, and Material 22 animates with CSS, reading
        // prefers-reduced-motion itself. The provider only put the 66 KB
        // animation engine on the initial path, and its renderer deferred
        // every DOM removal, so a routed page stayed beside the next one
        // until the following tick (workspace-shell.md, "Route swaps").
        // CDK overlays (menus, tooltips, dialogs) live in a container under
        // <body>, which the browser hides behind an element in DOM fullscreen.
        // This container follows the fullscreen element instead, so the
        // fullscreen channel panel's sort/context menus and the controls'
        // tooltips render while the player is fullscreen.
        { provide: OverlayContainer, useClass: FullscreenOverlayContainer },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideStore({
            router: routerReducer,
            playlistState: playlistReducer,
        }),
        provideEffects([PlaylistEffects]),
        provideRouterStore(),
        ...storeDevtoolsProviders,
        provideServiceWorker('ngsw-worker.js', {
            enabled: shouldEnableServiceWorker(),
            registrationStrategy: 'registerWhenStable:30000',
        }),
        importProvidersFrom(
            NgxIndexedDBModule.forRoot(dbConfig),
            NgxSkeletonLoaderModule.forRoot({
                animation: 'pulse',
                loadingText: 'This item is actually loading...',
            }),
            TranslateModule.forRoot({
                defaultLanguage: getInitialLanguage(),
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
        {
            provide: STALKER_PLAYLIST_CONNECTION_EDITOR,
            useExisting: LazyStalkerPlaylistConnectionEditor,
        },
        ...provideWorkspaceShellActions(),
        ...provideParentalLockPrompt(),
        provideParentalLockPlaylistCleanup(),
        ...provideXtreamDataSource(),
    ],
};

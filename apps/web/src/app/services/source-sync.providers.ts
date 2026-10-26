import { HttpInterceptorFn } from '@angular/common/http';
import { inject, provideAppInitializer } from '@angular/core';
import { Store } from '@ngrx/store';
import { Router } from '@angular/router';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { dbConfig } from '@iptvnator/shared/interfaces';
import { USER_DATA_STORAGE, type UserDataStorage } from '@iptvnator/services';
import { CONFIG_TOKEN } from 'ngx-indexed-db';
import {
    SourceSyncService,
    sourceAuthorization,
    sourceProfileName,
} from '@iptvnator/services/source-sync';

export const sourceAuthInterceptor: HttpInterceptorFn = (request, next) =>
    next(request.clone({ setHeaders: sourceAuthorization(request.url) }));

export function provideSourceSync() {
    return [
        {
            provide: CONFIG_TOKEN,
            useFactory: () => {
                const config = { ...dbConfig, name: sourceProfileName() };
                return { [config.name]: config };
            },
        },
        {
            provide: USER_DATA_STORAGE,
            useFactory: (): UserDataStorage => {
                const prefix =
                    sourceProfileName() === 'iptvnator'
                        ? ''
                        : `${sourceProfileName()}:`;
                return {
                    getItem: (key) => localStorage.getItem(`${prefix}${key}`),
                    setItem: (key, value) =>
                        localStorage.setItem(`${prefix}${key}`, value),
                    removeItem: (key) =>
                        localStorage.removeItem(`${prefix}${key}`),
                };
            },
        },
        provideAppInitializer(() => {
            const sync = inject(SourceSyncService);
            const store = inject(Store);
            const router = inject(Router);
            sync.changes.subscribe(() => {
                store.dispatch(PlaylistActions.loadSharedPlaylists());
                const activeId = router.url.match(
                    /\/workspace\/(?:playlists|xtreams|stalker)\/([^/?]+)/
                )?.[1];
                if (
                    activeId &&
                    !sync.sourceIds().has(decodeURIComponent(activeId))
                )
                    void router.navigateByUrl('/workspace/sources');
            });
            return sync.initialize();
        }),
    ];
}

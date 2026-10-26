import { HttpInterceptorFn } from '@angular/common/http';
import {
    EnvironmentInjector,
    inject,
    provideAppInitializer,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { Router } from '@angular/router';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { dbConfig } from '@iptvnator/shared/interfaces';
import {
    PlaylistsService,
    USER_DATA_STORAGE,
    type UserDataStorage,
} from '@iptvnator/services';
import { firstValueFrom } from 'rxjs';
import { CONFIG_TOKEN } from 'ngx-indexed-db';
import {
    sourceAuthorization,
    assertSourceRequestAllowed,
    sourceProfileName,
    sourceConnection,
} from '@iptvnator/services/source-sync/connection';
import { createSourceProfileUserDataStorage } from '@iptvnator/services/source-sync/profile-user-data';

export const sourceAuthInterceptor: HttpInterceptorFn = (request, next) => {
    assertSourceRequestAllowed(request.url);
    return next(
        request.clone({ setHeaders: sourceAuthorization(request.url) })
    );
};

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
            useFactory: (): UserDataStorage =>
                createSourceProfileUserDataStorage(
                    sourceProfileName(),
                    sourceConnection()?.instanceId
                ),
        },
        provideAppInitializer(() => {
            if (!sourceConnection()) return;
            const injector = inject(EnvironmentInjector);
            const store = inject(Store);
            const router = inject(Router);
            const playlists = inject(PlaylistsService);
            return import('./source-sync-runtime').then(
                ({ SourceSyncService }) => {
                    const sync = injector.get(SourceSyncService);
                    sync.changes.subscribe(() => {
                        store.dispatch(PlaylistActions.loadSharedPlaylists());
                        const activeId = router.url.match(
                            /\/workspace\/(?:playlists|xtreams|stalker)\/([^/?]+)/
                        )?.[1];
                        if (
                            activeId &&
                            !sync.sourceIds().has(decodeURIComponent(activeId))
                        ) {
                            void router.navigateByUrl('/workspace/sources');
                            return;
                        }
                        const activeM3uId = router.url.match(
                            /\/workspace\/playlists\/([^/?]+)/
                        )?.[1];
                        if (activeM3uId) {
                            const url = router.url;
                            const id = decodeURIComponent(activeM3uId);
                            void firstValueFrom(playlists.getPlaylistById(id))
                                .then((playlist) => {
                                    if (
                                        router.url === url &&
                                        playlist?.playlist
                                    )
                                        store.dispatch(
                                            PlaylistActions.hydrateSharedPlaylist(
                                                {
                                                    playlist,
                                                    playlistId: id,
                                                }
                                            )
                                        );
                                })
                                .catch(() => undefined);
                        }
                    });
                    return sync.initialize();
                }
            );
        }),
    ];
}

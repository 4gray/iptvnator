import { HttpInterceptorFn } from '@angular/common/http';
import {
    EnvironmentInjector,
    inject,
    provideAppInitializer,
    runInInjectionContext,
} from '@angular/core';
import { dbConfig } from '@iptvnator/shared/interfaces';
import { USER_DATA_STORAGE, type UserDataStorage } from '@iptvnator/services';
import { from, switchMap } from 'rxjs';
import { CONFIG_TOKEN } from 'ngx-indexed-db';
import {
    isSourceBackendRequest,
    sourceProfileName,
    sourceConnection,
    sourceConnectionReadFailed,
} from '@iptvnator/services/source-sync/connection';
import { createSourceProfileUserDataStorage } from '@iptvnator/services/source-sync/profile-user-data';

export const sourceAuthInterceptor: HttpInterceptorFn = (request, next) => {
    if (!isSourceBackendRequest(request.url)) return next(request);
    return from(import('./source-proxy')).pipe(
        switchMap(({ interceptSourceProxy }) =>
            interceptSourceProxy(request, next)
        )
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
            if (!sourceConnection() && !sourceConnectionReadFailed()) return;
            const injector = inject(EnvironmentInjector);
            return import('./source-sync-runtime').then(
                ({ initializeSourceSync }) =>
                    runInInjectionContext(injector, initializeSourceSync)
            );
        }),
    ];
}

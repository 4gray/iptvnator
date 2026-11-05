import { HTTP_INTERCEPTORS } from '@angular/common/http';
import {
    EnvironmentProviders,
    inject,
    provideAppInitializer,
    Provider,
} from '@angular/core';
import { USER_DATA_STORAGE } from '@iptvnator/services';
import {
    SERVER_STORAGE_CONFIG,
    ServerAccessTokenInterceptor,
    ServerStorageSession,
} from '@iptvnator/services/server-storage';
import { ServerMigrationPrompt } from './server-migration-prompt.service';
import type { ServerStorageStart } from './server-storage-start';

/** Loaded with a dynamic import from `main.ts`, only in server mode. */
export function provideServerStorage(
    start: ServerStorageStart,
    baseUrl: string
): (Provider | EnvironmentProviders)[] {
    return [
        {
            provide: SERVER_STORAGE_CONFIG,
            useValue: {
                instance: start.instance,
                startedOffline: start.startedOffline,
                baseUrl,
            },
        },
        {
            provide: USER_DATA_STORAGE,
            useFactory: () => inject(ServerStorageSession).userData,
        },
        {
            provide: HTTP_INTERCEPTORS,
            useClass: ServerAccessTokenInterceptor,
            multi: true,
        },
        provideAppInitializer(() => inject(ServerStorageSession).start()),
        provideAppInitializer(() => inject(ServerMigrationPrompt).schedule()),
    ];
}

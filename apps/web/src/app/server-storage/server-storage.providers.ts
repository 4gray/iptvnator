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
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import { ServerMigrationPrompt } from './server-migration-prompt.service';

/** Loaded with a dynamic import from `main.ts`, only in server mode. */
export function provideServerStorage(
    instance: ServerInstanceInfo,
    baseUrl: string
): (Provider | EnvironmentProviders)[] {
    return [
        { provide: SERVER_STORAGE_CONFIG, useValue: { instance, baseUrl } },
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

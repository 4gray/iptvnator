import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import {
    SERVER_SIGN_IN_PATH,
    ServerStorageStatusService,
} from '@iptvnator/services';

/** Without a valid token the workspace would show an empty library. */
export const serverAccessGuard: CanActivateFn = () =>
    inject(ServerStorageStatusService).state() === 'unauthorized'
        ? inject(Router).parseUrl(SERVER_SIGN_IN_PATH)
        : true;

export const serverSignInGuard: CanActivateFn = () =>
    inject(ServerStorageStatusService).state() === 'unauthorized'
        ? true
        : inject(Router).parseUrl('/workspace');

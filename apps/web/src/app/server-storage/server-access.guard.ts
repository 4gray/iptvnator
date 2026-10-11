import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ServerStorageStatusService } from '@iptvnator/services';

/** Without a valid token the workspace would show an empty library. */
export const serverAccessGuard: CanActivateFn = () =>
    inject(ServerStorageStatusService).state() === 'unauthorized'
        ? inject(Router).parseUrl('/server-sign-in')
        : true;

export const serverSignInGuard: CanActivateFn = () =>
    inject(ServerStorageStatusService).state() === 'unauthorized'
        ? true
        : inject(Router).parseUrl('/workspace');

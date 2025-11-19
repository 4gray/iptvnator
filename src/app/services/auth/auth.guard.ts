import { inject } from '@angular/core';
import { Router, CanActivateFn, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from './auth.service';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

/**
 * Route guard that protects routes requiring authentication
 */
export const authGuard: CanActivateFn = (
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
) => {
    const authService = inject(AuthService);
    const router = inject(Router);

    return authService.isAuthenticated().pipe(
        map((isAuthenticated) => {
            if (isAuthenticated) {
                return true;
            } else {
                // Store the attempted URL for redirecting after login
                authService.redirectUrl = state.url;
                // Redirect to login
                authService.login();
                return false;
            }
        }),
        catchError(() => {
            // On error, redirect to login
            authService.redirectUrl = state.url;
            authService.login();
            return of(false);
        })
    );
};


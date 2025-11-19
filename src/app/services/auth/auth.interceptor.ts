import { HttpInterceptorFn, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { switchMap, take } from 'rxjs/operators';

/**
 * HTTP Interceptor that adds the access token to outgoing requests
 */
export const authInterceptor: HttpInterceptorFn = (
    req: HttpRequest<unknown>,
    next: HttpHandlerFn
) => {
    const authService = inject(AuthService);

    // Get the current user's access token
    return authService.getAccessToken().pipe(
        take(1),
        switchMap((token) => {
            // If we have a token, add it to the request headers
            if (token) {
                const clonedRequest = req.clone({
                    setHeaders: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                return next(clonedRequest);
            }
            // If no token, proceed with the original request
            return next(req);
        })
    );
};



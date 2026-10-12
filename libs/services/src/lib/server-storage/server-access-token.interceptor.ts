import {
    HttpErrorResponse,
    HttpEvent,
    HttpHandler,
    HttpInterceptor,
    HttpRequest,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, tap } from 'rxjs';
import {
    isServerAccessChallenge,
    readServerAccessToken,
} from '../server-access-token';
import { ServerStorageStatusService } from '../server-storage-status.service';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';

/**
 * Adds the server access token to `HttpClient` calls to the backend, and
 * sends the user to sign-in when the backend refuses it (a token changed
 * on the server while this page was open).
 */
@Injectable()
export class ServerAccessTokenInterceptor implements HttpInterceptor {
    private readonly status = inject(ServerStorageStatusService);
    private readonly baseUrl = inject(SERVER_STORAGE_CONFIG).baseUrl;

    intercept(
        request: HttpRequest<unknown>,
        next: HttpHandler
    ): Observable<HttpEvent<unknown>> {
        if (!isBackendUrl(request.url, this.baseUrl)) {
            return next.handle(request);
        }
        const token = readServerAccessToken();
        const sent = token
            ? request.clone({
                  setHeaders: { Authorization: `Bearer ${token}` },
              })
            : request;
        return next.handle(sent).pipe(
            tap({
                error: (error: unknown) => {
                    if (
                        error instanceof HttpErrorResponse &&
                        isServerAccessChallenge(
                            error.status,
                            error.headers.get('WWW-Authenticate')
                        )
                    ) {
                        this.status.reportAccessDenied();
                    }
                },
            })
        );
    }
}

/**
 * Whether `url` goes to the backend: the same origin as the backend URL and
 * a path inside it. A plain prefix check fails for `BACKEND_URL=/`, where
 * every URL, other origins included, would carry the token.
 */
export function isBackendUrl(
    url: string,
    baseUrl: string,
    pageUrl = globalThis.location?.href ?? 'http://localhost/'
): boolean {
    try {
        const base = new URL(baseUrl, pageUrl);
        const target = new URL(url, pageUrl);
        const root = base.pathname.endsWith('/')
            ? base.pathname
            : `${base.pathname}/`;
        return (
            target.origin === base.origin &&
            (target.pathname === base.pathname ||
                target.pathname.startsWith(root))
        );
    } catch {
        return false;
    }
}

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
    isBackendUrl,
    isGatewayOutage,
    isServerAccessChallenge,
} from '../server-access-token';

// Lives with the token helpers so the startup bundle can check URLs
// without loading the server storage code.
export { isBackendUrl } from '../server-access-token';
import { ServerStorageStatusService } from '../server-storage-status.service';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';

/**
 * Adds the server access token to `HttpClient` calls to the backend, sends
 * the user to sign-in when the backend refuses it (a token changed on the
 * server while this page was open), and reports a backend that does not
 * answer as offline, like the storage API client does.
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
        const token = this.status.accessToken();
        const sent = token
            ? request.clone({
                  setHeaders: { Authorization: `Bearer ${token}` },
              })
            : request;
        return next.handle(sent).pipe(
            tap({
                error: (error: unknown) => {
                    if (!(error instanceof HttpErrorResponse)) {
                        return;
                    }
                    if (
                        error.status === 0 ||
                        isGatewayOutage(
                            error.status,
                            error.headers.get('Content-Type')
                        )
                    ) {
                        // No answer: it may come back as another instance,
                        // checked before the token goes out again.
                        this.status.reportOffline();
                    } else if (
                        isServerAccessChallenge(
                            error.status,
                            error.headers.get('WWW-Authenticate')
                        )
                    ) {
                        this.status.reportAccessDenied(token);
                    }
                },
            })
        );
    }
}

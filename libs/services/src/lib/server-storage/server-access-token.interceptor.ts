import {
    HttpEvent,
    HttpHandler,
    HttpInterceptor,
    HttpRequest,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { readServerAccessToken } from '../server-access-token';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';

/** Adds the server access token to `HttpClient` calls to the backend. */
@Injectable()
export class ServerAccessTokenInterceptor implements HttpInterceptor {
    private readonly baseUrl = inject(SERVER_STORAGE_CONFIG).baseUrl.replace(
        /\/+$/,
        ''
    );

    intercept(
        request: HttpRequest<unknown>,
        next: HttpHandler
    ): Observable<HttpEvent<unknown>> {
        const token = readServerAccessToken();
        if (!token || !request.url.startsWith(this.baseUrl)) {
            return next.handle(request);
        }
        return next.handle(
            request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
        );
    }
}

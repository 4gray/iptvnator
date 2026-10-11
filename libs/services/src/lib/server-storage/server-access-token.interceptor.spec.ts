import {
    HTTP_INTERCEPTORS,
    HttpClient,
    provideHttpClient,
    withInterceptorsFromDi,
} from '@angular/common/http';
import {
    HttpTestingController,
    provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SERVER_ACCESS_TOKEN_STORAGE_KEY } from '../server-access-token';
import { ServerStorageStatusService } from '../server-storage-status.service';
import { ServerAccessTokenInterceptor } from './server-access-token.interceptor';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';

describe('ServerAccessTokenInterceptor', () => {
    beforeEach(() => {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, 't');
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptorsFromDi()),
                provideHttpClientTesting(),
                {
                    provide: HTTP_INTERCEPTORS,
                    useClass: ServerAccessTokenInterceptor,
                    multi: true,
                },
                {
                    provide: SERVER_STORAGE_CONFIG,
                    useValue: { baseUrl: '/api', instance: {} },
                },
            ],
        });
    });

    afterEach(() => localStorage.clear());

    it('adds the token to backend calls only', () => {
        const http = TestBed.inject(HttpClient);
        const controller = TestBed.inject(HttpTestingController);

        http.get('/api/parse').subscribe();
        http.get('https://provider.example/list.m3u').subscribe();

        expect(
            controller
                .expectOne('/api/parse')
                .request.headers.get('Authorization')
        ).toBe('Bearer t');
        expect(
            controller
                .expectOne('https://provider.example/list.m3u')
                .request.headers.has('Authorization')
        ).toBe(false);
    });

    it('asks for a new token when the backend refuses the stored one', () => {
        const status = TestBed.inject(ServerStorageStatusService);
        status.activate(
            {
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: 'i',
                storage: 'server',
                auth: 'token',
            },
            () => undefined
        );
        const http = TestBed.inject(HttpClient);
        const controller = TestBed.inject(HttpTestingController);

        // A provider's own 401 passed on by the proxy changes nothing.
        http.get('/api/xtream').subscribe({ error: () => undefined });
        controller
            .expectOne('/api/xtream')
            .flush({ message: 'bad login' }, { status: 401, statusText: 'x' });
        expect(status.state()).toBe('online');

        http.get('/api/xtream').subscribe({ error: () => undefined });
        controller.expectOne('/api/xtream').flush(
            { code: 'unauthorized' },
            {
                status: 401,
                statusText: 'Unauthorized',
                headers: { 'WWW-Authenticate': 'Bearer realm="iptvnator"' },
            }
        );
        expect(status.state()).toBe('unauthorized');
        expect(
            localStorage.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)
        ).toBeNull();
    });
});

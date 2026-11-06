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
import {
    SERVER_ACCESS_TOKEN_STORAGE_KEY,
    writeServerAccessToken,
} from '../server-access-token';
import { ServerStorageStatusService } from '../server-storage-status.service';
import {
    isBackendUrl,
    ServerAccessTokenInterceptor,
} from './server-access-token.interceptor';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';

describe('ServerAccessTokenInterceptor', () => {
    beforeEach(() => {
        writeServerAccessToken('t', 'i');
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

    const activate = (verified = true) =>
        TestBed.inject(ServerStorageStatusService).activate(
            {
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: 'i',
                storage: 'server',
                auth: 'token',
            },
            () => undefined,
            verified
        );

    it('adds the token to backend calls only', () => {
        activate();
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

    it('withholds the token from an instance not checked yet', () => {
        activate(false);
        const http = TestBed.inject(HttpClient);
        const controller = TestBed.inject(HttpTestingController);

        http.get('/api/v1/instance').subscribe();

        expect(
            controller
                .expectOne('/api/v1/instance')
                .request.headers.has('Authorization')
        ).toBe(false);
        controller.verify();
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

    it('reports a backend that does not answer as offline, not a provider failing', () => {
        const status = TestBed.inject(ServerStorageStatusService);
        activate();
        const http = TestBed.inject(HttpClient);
        const controller = TestBed.inject(HttpTestingController);

        // The backend's own JSON error for a provider that failed.
        http.get('/api/xtream').subscribe({ error: () => undefined });
        controller.expectOne('/api/xtream').flush(
            { message: 'provider down' },
            {
                status: 502,
                statusText: 'Bad Gateway',
                headers: { 'Content-Type': 'application/json' },
            }
        );
        expect(status.state()).toBe('online');
        expect(status.isVerified()).toBe(true);

        // No answer at all: it may come back as another instance.
        http.get('/api/parse').subscribe({ error: () => undefined });
        controller
            .expectOne('/api/parse')
            .error(new ProgressEvent('error'), { status: 0 });
        expect(status.state()).toBe('offline');
        expect(status.accessToken()).toBeNull();
    });
});

describe('isBackendUrl', () => {
    const page = 'http://nas.local:4333/workspace';

    it('matches the backend path and nothing else', () => {
        expect(isBackendUrl('/api/xtream', '/api', page)).toBe(true);
        expect(isBackendUrl('/api', '/api', page)).toBe(true);
        expect(isBackendUrl('/apiary', '/api', page)).toBe(false);
        expect(isBackendUrl('https://other.test/api/x', '/api', page)).toBe(
            false
        );
    });

    it('keeps other origins out for a root deployment', () => {
        expect(isBackendUrl('/v1/playlists', '/', page)).toBe(true);
        expect(
            isBackendUrl('https://api.github.com/repos/x/releases', '/', page)
        ).toBe(false);
    });

    it('handles an absolute backend URL', () => {
        expect(
            isBackendUrl(
                'http://nas.local:3000/parse',
                'http://nas.local:3000',
                page
            )
        ).toBe(true);
        expect(isBackendUrl('/parse', 'http://nas.local:3000', page)).toBe(
            false
        );
    });
});

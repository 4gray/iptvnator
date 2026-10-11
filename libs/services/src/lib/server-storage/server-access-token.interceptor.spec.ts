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
});

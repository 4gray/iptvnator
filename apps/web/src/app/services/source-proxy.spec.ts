import {
    assertSourceRequestAllowed,
    sourceAuthorization,
    verifySourceInstance,
} from '@iptvnator/services/source-sync/authorization';
import {
    HttpErrorResponse,
    HttpHeaders,
    HttpRequest,
    HttpResponse,
} from '@angular/common/http';
import { firstValueFrom, of, throwError } from 'rxjs';
import {
    invalidateSourceVerification,
    prepareSourceConnection,
    tokenKey,
} from '@iptvnator/services/source-sync/connection';
import { sourceAuthInterceptor } from './source-sync.providers';
import { ensureSourceProxy } from './source-proxy';
import { requestSourceServer } from '@iptvnator/services/source-sync';

describe('selected source-server proxy recovery', () => {
    const originalElectron = window.electron;
    const originalFetch = globalThis.fetch;
    const connection = { apiUrl: 'https://nas.test/api', instanceId: 'nas' };
    const url = `${connection.apiUrl}/xtream`;
    const instance = {
        service: 'iptvnator',
        apiVersion: 1,
        storage: 'server',
        instanceId: 'nas',
        capabilities: ['sources-v1'],
    };
    beforeEach(async () => {
        Reflect.deleteProperty(window, 'electron');
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify(connection)
        );
        sessionStorage.setItem(tokenKey(connection), 'nas-secret');
        await prepareSourceConnection();
        verifySourceInstance(instance);
    });
    afterEach(async () => {
        localStorage.clear();
        sessionStorage.clear();
        await prepareSourceConnection();
        window.electron = originalElectron;
        globalThis.fetch = originalFetch;
    });

    it.each([0, 502, 503, 504])(
        'revokes authorization after HTTP proxy status %s and probes anonymously before retrying',
        async (status) => {
            const request = new HttpRequest('POST', url, {
                providerPassword: 'private',
            });
            const next = jest.fn((_request: HttpRequest<unknown>) =>
                throwError(
                    () =>
                        new HttpErrorResponse({
                            status,
                            headers: new HttpHeaders({
                                'content-type': 'text/html',
                            }),
                        })
                )
            );
            await expect(
                firstValueFrom(sourceAuthInterceptor(request, next))
            ).rejects.toBeInstanceOf(HttpErrorResponse);
            expect(next.mock.calls[0][0].headers.get('Authorization')).toBe(
                'Bearer nas-secret'
            );
            expect(sourceAuthorization(url)).toEqual({});
            globalThis.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    ...instance,
                    instanceId: 'replacement',
                }),
            });
            next.mockClear();
            await expect(
                firstValueFrom(sourceAuthInterceptor(request, next))
            ).rejects.toThrow('SOURCE_SYNC.INSTANCE_CHANGED');
            expect(next).not.toHaveBeenCalled();
            expect(globalThis.fetch).toHaveBeenCalledWith(
                `${connection.apiUrl}/v1/instance`,
                expect.objectContaining({
                    redirect: 'error',
                    cache: 'no-store',
                })
            );
            expect(
                (globalThis.fetch as jest.Mock).mock.calls[0][1].headers
            ).toBeUndefined();
        }
    );

    it('resumes immediately after a successful identity probe and deduplicates concurrent retries', async () => {
        invalidateSourceVerification();
        let finish!: (value: unknown) => void;
        globalThis.fetch = jest.fn(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        ) as never;
        const first = ensureSourceProxy(url);
        const second = ensureSourceProxy(url);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        finish({ ok: true, json: async () => instance });
        await Promise.all([first, second]);
        const next = jest.fn((_request: HttpRequest<unknown>) =>
            of(new HttpResponse({ status: 200 }))
        );
        await firstValueFrom(
            sourceAuthInterceptor(new HttpRequest('GET', url), next)
        );
        expect(next.mock.calls[0][0].headers.get('Authorization')).toBe(
            'Bearer nas-secret'
        );
    });

    it('does not restore verification from an older probe after a second outage', async () => {
        invalidateSourceVerification();
        let finish!: (value: unknown) => void;
        globalThis.fetch = jest.fn(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        ) as never;
        const request = ensureSourceProxy(url);
        invalidateSourceVerification();
        finish({ ok: true, json: async () => instance });
        await expect(request).rejects.toThrow('SOURCE_SYNC.OFFLINE');
        expect(() => assertSourceRequestAllowed(url)).toThrow();
    });

    it('keeps verification for an application JSON provider failure', async () => {
        const next = () =>
            throwError(
                () =>
                    new HttpErrorResponse({
                        status: 503,
                        headers: new HttpHeaders({
                            'content-type': 'application/json',
                        }),
                    })
            );
        await expect(
            firstValueFrom(
                sourceAuthInterceptor(new HttpRequest('GET', url), next)
            )
        ).rejects.toBeInstanceOf(HttpErrorResponse);
        expect(sourceAuthorization(url)).toEqual({
            Authorization: 'Bearer nas-secret',
        });
    });

    it('probes before sending provider secrets after a direct source import fails', async () => {
        const fetchMock = jest
            .fn()
            .mockRejectedValueOnce(new TypeError('offline'))
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ ...instance, instanceId: 'replacement' }),
            });
        globalThis.fetch = fetchMock;
        await expect(
            requestSourceServer({ operation: 'create', id: 'import' })
        ).rejects.toThrow('SOURCE_SYNC.OFFLINE');
        const next = jest.fn(() => of(new HttpResponse({ status: 200 })));
        await expect(
            firstValueFrom(
                sourceAuthInterceptor(new HttpRequest('GET', url), next)
            )
        ).rejects.toThrow('SOURCE_SYNC.INSTANCE_CHANGED');
        expect(next).not.toHaveBeenCalled();
        expect(fetchMock.mock.calls[1][0]).toBe(
            `${connection.apiUrl}/v1/instance`
        );
        expect(fetchMock.mock.calls[1][1].headers).toBeUndefined();
    });
});

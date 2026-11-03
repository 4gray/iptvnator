import { FetchBackend, HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { TextDecoder } from 'node:util';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import { forwardPwaXtreamRequest } from './pwa-xtream-request';
import { ProviderTargetClient } from './provider-target-client';

describe('PWA long catalog downloads', () => {
    it('allows a healthy backend transfer to finish after 30 seconds', async () => {
        const originalFetch = globalThis.fetch;
        const decoder = Object.getOwnPropertyDescriptor(
            globalThis,
            'TextDecoder'
        );
        jest.useFakeTimers();
        Object.defineProperty(globalThis, 'TextDecoder', {
            configurable: true,
            value: TextDecoder,
        });
        jest.spyOn(window, 'postMessage').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        let networkSignal: AbortSignal | undefined;
        globalThis.fetch = jest.fn((_url, init) => {
            networkSignal = init?.signal ?? undefined;
            return new Promise<Response>((resolve, reject) => {
                networkSignal?.addEventListener(
                    'abort',
                    () => reject(networkSignal?.reason),
                    { once: true }
                );
                setTimeout(() => {
                    let sent = false;
                    resolve({
                        status: 200,
                        statusText: 'OK',
                        headers: new Map([
                            ['content-type', 'application/json'],
                        ]),
                        body: {
                            getReader: () => ({
                                read: async () => {
                                    if (sent) return { done: true };
                                    sent = true;
                                    return {
                                        done: false,
                                        value: Uint8Array.from(
                                            '{"payload":[]}',
                                            (char) => char.charCodeAt(0)
                                        ),
                                    };
                                },
                            }),
                        },
                    } as unknown as Response);
                }, 31_000);
            });
        });
        try {
            TestBed.configureTestingModule({});
            // Exercise Angular's real timeout/abort implementation, rather than HttpTestingBackend.
            const backend = TestBed.runInInjectionContext(
                () => new FetchBackend()
            );
            const result = forwardPwaXtreamRequest(
                {
                    http: new HttpClient(backend),
                    proxyUrl: '/api',
                    providerTargets: new ProviderTargetClient(
                        async () => 'synthetic'
                    ),
                    logger: createLogger('test'),
                    translate: { instant: () => 'Synthetic failure' },
                    snackBar: { open: jest.fn().mockResolvedValue(null) },
                    errorStatus: () => 0,
                },
                {
                    url: 'https://synthetic.test',
                    params: { action: 'get_vod_streams' },
                }
            );
            await jest.advanceTimersByTimeAsync(31_000);
            expect(networkSignal?.aborted).toBe(false);
            await expect(result).resolves.toMatchObject({ payload: [] });
        } finally {
            globalThis.fetch = originalFetch;
            if (decoder)
                Object.defineProperty(globalThis, 'TextDecoder', decoder);
            else Reflect.deleteProperty(globalThis, 'TextDecoder');
            jest.useRealTimers();
            jest.restoreAllMocks();
        }
    });
});

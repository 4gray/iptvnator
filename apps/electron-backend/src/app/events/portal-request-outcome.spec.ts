import {
    classifyExpectedPortalFailure,
    isCancelledPortalRequest,
    logPortalRequestFailure,
} from './portal-request-outcome';

const REQUEST_URL =
    'http://portal.example.com:8080/stalker_portal/server/load.php?type=stb&action=handshake&mac=00%3A1A%3A79%3AAA%3ABB%3ACC&token=secret-token';

describe('classifyExpectedPortalFailure', () => {
    it.each([
        [
            'an axios CanceledError',
            Object.assign(new Error('canceled'), {
                code: 'ERR_CANCELED',
                name: 'CanceledError',
            }),
        ],
        [
            'a bare ERR_CANCELED code',
            Object.assign(new Error('cancelled'), {
                code: 'ERR_CANCELED',
            }),
        ],
        [
            'an AbortError raised before axios',
            Object.assign(new Error('aborted'), { name: 'AbortError' }),
        ],
    ])('reads %s as a cancellation', (_label, error) => {
        expect(isCancelledPortalRequest(error)).toBe(true);
        expect(classifyExpectedPortalFailure(error)).toEqual({
            kind: 'cancelled',
        });
    });

    it.each([401, 403])(
        'reads a thrown HTTP %s as a refusal, keeping the status text',
        (status) => {
            const error = Object.assign(
                new Error(`HTTP Error ${status}: Refused`),
                { status, statusText: 'Refused' }
            );

            expect(classifyExpectedPortalFailure(error)).toEqual({
                kind: 'http',
                status,
                statusText: 'Refused',
            });
            expect(
                classifyExpectedPortalFailure({ message: 'refused', status })
            ).toEqual({ kind: 'http', status });
        }
    );

    it.each([
        [
            'a 404',
            Object.assign(new Error('HTTP Error 404: Not Found'), {
                status: 404,
            }),
        ],
        [
            'a 5xx axios error',
            Object.assign(new Error('Bad Gateway'), {
                code: 'ERR_BAD_RESPONSE',
                response: { status: 502, statusText: 'Bad Gateway' },
            }),
        ],
        [
            'a refused connection',
            Object.assign(new Error('ECONNREFUSED'), {
                code: 'ECONNREFUSED',
            }),
        ],
        [
            'an axios timeout',
            Object.assign(new Error('timeout exceeded'), {
                code: 'ECONNABORTED',
            }),
        ],
        ['a parse error', new SyntaxError('Unexpected token')],
        ['a non-object', 'boom'],
    ])('keeps %s a real failure', (_label, error) => {
        expect(classifyExpectedPortalFailure(error)).toBeNull();
    });

    it('does not read a 401 inside a cancelled request as a refusal', () => {
        const error = Object.assign(new Error('canceled'), {
            code: 'ERR_CANCELED',
            response: { status: 401 },
        });

        expect(classifyExpectedPortalFailure(error)).toEqual({
            kind: 'cancelled',
        });
    });
});

describe('logPortalRequestFailure', () => {
    const originalTraceIpc = process.env['IPTVNATOR_TRACE_IPC'];
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        delete process.env['IPTVNATOR_TRACE_IPC'];
        logSpy = jest.spyOn(console, 'log').mockImplementation();
        warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        errorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
        if (originalTraceIpc === undefined) {
            delete process.env['IPTVNATOR_TRACE_IPC'];
        } else {
            process.env['IPTVNATOR_TRACE_IPC'] = originalTraceIpc;
        }
    });

    const allOutput = () =>
        JSON.stringify([
            ...logSpy.mock.calls,
            ...warnSpy.mock.calls,
            ...errorSpy.mock.calls,
        ]);

    it('is silent about a cancellation unless the IPC trace is on', () => {
        const cancelled = Object.assign(new Error('canceled'), {
            code: 'ERR_CANCELED',
        });

        logPortalRequestFailure(
            'STALKER_REQUEST',
            { kind: 'cancelled' },
            cancelled,
            REQUEST_URL,
            'handshake'
        );
        expect(allOutput()).toBe('[]');

        process.env['IPTVNATOR_TRACE_IPC'] = '1';
        logPortalRequestFailure(
            'STALKER_REQUEST',
            { kind: 'cancelled' },
            cancelled,
            REQUEST_URL,
            'handshake'
        );
        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy.mock.calls[0][0]).toContain('[STALKER_REQUEST]');
        expect(logSpy.mock.calls[0][0]).toContain('cancelled');
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('warns once about an HTTP refusal, with host and pathname only', () => {
        logPortalRequestFailure(
            'XTREAM_REQUEST',
            { kind: 'http', status: 401, statusText: 'Unauthorized' },
            Object.assign(new Error('HTTP Error 401: Unauthorized'), {
                status: 401,
            }),
            REQUEST_URL,
            'handshake'
        );

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toBe('[XTREAM_REQUEST] Refused');
        expect(warnSpy.mock.calls[0][1]).toMatchObject({
            action: 'handshake',
            host: 'portal.example.com:8080',
            pathname: '/stalker_portal/server/load.php',
            status: 401,
        });
        expect(errorSpy).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('keeps a real failure at error level', () => {
        logPortalRequestFailure(
            'STALKER_REQUEST',
            null,
            Object.assign(new Error('connect ECONNREFUSED'), {
                code: 'ECONNREFUSED',
            }),
            REQUEST_URL,
            'handshake'
        );

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toBe('[STALKER_REQUEST] Failed');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['cancelled', { kind: 'cancelled' } as const],
        ['http', { kind: 'http', status: 403 } as const],
        ['failed', null],
    ])(
        'never writes the MAC, token or query string (%s)',
        (_label, expected) => {
            process.env['IPTVNATOR_TRACE_IPC'] = '1';
            logPortalRequestFailure(
                'STALKER_REQUEST',
                expected,
                Object.assign(new Error('HTTP Error 403: Forbidden'), {
                    status: 403,
                    config: { url: REQUEST_URL },
                }),
                REQUEST_URL,
                'handshake'
            );

            const output = allOutput();
            expect(output).not.toBe('[]');
            expect(output).not.toContain('00:1A:79');
            expect(output).not.toContain('00%3A1A');
            expect(output).not.toContain('secret-token');
            expect(output).not.toContain('load.php?');
        }
    );
});

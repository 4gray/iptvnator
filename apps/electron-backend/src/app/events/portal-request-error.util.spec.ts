import { AxiosError } from 'axios';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import { formatPortalRequestError } from './portal-request-error.util';

describe('formatPortalRequestError', () => {
    const xtreamUrl =
        'http://provider.example:8080/player_api.php?username=user&password=secret&action=get_vod_streams';
    const stalkerUrl =
        'http://portal.example/stalker_portal/server/load.php?action=get_ordered_list&type=vod&p=1&JsHttpRequest=1-xml';

    it('keeps only host and pathname of the request URL, never the query', () => {
        const formatted = formatPortalRequestError(
            new Error('timeout of 30000ms exceeded'),
            xtreamUrl,
            'get_vod_streams'
        );

        expect(formatted.host).toBe('provider.example:8080');
        expect(formatted.pathname).toBe('/player_api.php');
        const serialized = JSON.stringify(formatted);
        expect(serialized).not.toContain('secret');
        expect(serialized).not.toContain('username');
    });

    it('formats axios errors with code, status and syscall details', () => {
        const error = new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED');
        (error as AxiosError & { syscall?: string }).syscall = 'connect';
        (error as AxiosError & { hostname?: string }).hostname =
            'portal.example';

        const formatted = formatPortalRequestError(
            error,
            stalkerUrl,
            'get_ordered_list'
        );

        expect(formatted).toEqual({
            action: 'get_ordered_list',
            host: 'portal.example',
            pathname: '/stalker_portal/server/load.php',
            type: 'AxiosError',
            code: 'ECONNABORTED',
            status: undefined,
            message: 'timeout of 15000ms exceeded',
            syscall: 'connect',
            hostname: 'portal.example',
        });
    });

    it('reads the HTTP status from an axios error response', () => {
        const error = new AxiosError(
            'Request failed with status code 521',
            'ERR_BAD_RESPONSE',
            undefined,
            undefined,
            { status: 521 } as AxiosError['response']
        );

        const formatted = formatPortalRequestError(error, stalkerUrl);

        expect(formatted.type).toBe('AxiosError');
        expect(formatted.status).toBe(521);
    });

    it('formats plain error objects and Error instances as ErrorObject', () => {
        const httpError = new Error('HTTP Error 404: Not Found') as Error & {
            status: number;
        };
        httpError.status = 404;

        const formatted = formatPortalRequestError(httpError, stalkerUrl);

        expect(formatted).toEqual({
            action: undefined,
            host: 'portal.example',
            pathname: '/stalker_portal/server/load.php',
            type: 'ErrorObject',
            status: 404,
            message: 'HTTP Error 404: Not Found',
        });
    });

    it('stringifies non-object errors as UnknownError', () => {
        const formatted = formatPortalRequestError('boom', stalkerUrl);

        expect(formatted.type).toBe('UnknownError');
        expect(formatted.message).toBe('boom');
    });

    it('withholds the URL entirely when it cannot be parsed', () => {
        const formatted = formatPortalRequestError(
            new Error('fail'),
            'not-a-url'
        );

        expect(formatted.host).toBe('unknown');
        expect(formatted.pathname).toBe('[unparseable-url]');
    });

    // A malformed URL is exactly where redaction cannot help: the guard in
    // stalker.events.ts rejects credentialed portal URLs before the request
    // URL is built, so the raw playlist value reaches this formatter, and
    // redactSensitiveData passes an unparseable URL through verbatim.
    it('does not leak credentials of an unparseable credentialed URL', () => {
        const formatted = formatPortalRequestError(
            new Error('blocked by url guard'),
            'http://user:sup3rsecret@',
            'get_genres'
        );

        expect(
            JSON.stringify(redactSensitiveData(formatted))
        ).not.toContain('sup3rsecret');
    });
});

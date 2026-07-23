import {
    compactSqlForTrace,
    summarizeForTrace,
    trace,
} from './debug-trace';

describe('debug trace redaction', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('redacts DVR credentials and trusted filesystem paths', () => {
        const summary = summarizeForTrace({
            id: 'recording-1',
            streamUrl: 'https://user:password@example.com/live?token=secret',
            requestHeaders: { Authorization: 'Bearer secret' },
            recordingDirectory: '/Users/test/Movies',
            filePath: '/Users/test/Movies/private.ts',
        });

        expect(summary).toEqual({
            id: 'recording-1',
            streamUrl: '[REDACTED]',
            requestHeaders: '[REDACTED]',
            recordingDirectory: '[REDACTED]',
            filePath: '[REDACTED]',
        });
    });

    it('redacts header containers independent of casing and separators', () => {
        expect(
            summarizeForTrace({
                headers: { Cookie: 'session=secret' },
                request_headers: { Authorization: 'secret' },
            })
        ).toEqual({
            headers: '[REDACTED]',
            request_headers: '[REDACTED]',
        });
    });

    it('redacts expanded SQL string and blob literals', () => {
        const sql = compactSqlForTrace(
            "UPDATE recordings SET stream_url = 'https://user:secret@example.com/live', request_headers = '{\"Authorization\":\"Bearer secret\"}', output = X'736563726574' WHERE id = 'recording-1'"
        );

        expect(sql).toContain('UPDATE recordings SET stream_url = ?');
        expect(sql).not.toContain('user:secret');
        expect(sql).not.toContain('Bearer secret');
        expect(sql).not.toContain('736563726574');
        expect(sql).not.toContain('recording-1');
    });

    it('does not serialize credentials from nested payloads or URLs', () => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const secrets = {
            password: 'trace-password-secret',
            token: 'trace-token-secret',
            authorization: 'trace-authorization-secret',
            mac: 'trace-mac-secret',
        };

        trace('portal', 'request', {
            params: secrets,
            url: `https://example.com/portal?token=${secrets.token}&action=get_profile`,
            requestId: 'diagnostic-request-id',
        });

        const output = JSON.stringify((console.log as jest.Mock).mock.calls);
        for (const secret of Object.values(secrets)) {
            expect(output).not.toContain(secret);
        }
        expect(output).toContain('diagnostic-request-id');
        expect(output).toContain('get_profile');
    });

    it('redacts serialized credentials before truncating trace strings', () => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const secret = 'long-trace-json-password-secret';
        const diagnostic = JSON.stringify({
            password: secret,
            operation: 'get_profile',
            padding: 'x'.repeat(300),
        });

        trace('portal', 'request', { diagnostic });

        const output = JSON.stringify((console.log as jest.Mock).mock.calls);
        expect(output).not.toContain(secret);
        expect(output).toContain('[Redacted]');
        expect(output).toContain('get_profile');
    });
});

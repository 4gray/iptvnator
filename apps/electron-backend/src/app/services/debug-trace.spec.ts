import { trace } from './debug-trace';

describe('debug trace redaction', () => {
    afterEach(() => {
        jest.restoreAllMocks();
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

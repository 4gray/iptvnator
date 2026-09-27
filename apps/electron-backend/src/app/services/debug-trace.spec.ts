import { trace, traceSqlStatement } from './debug-trace';

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

    it('records only the statement type for expanded worker SQL', () => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const secrets = [
            'worker-user-secret',
            'worker-password-secret',
            'https://worker-user:worker-password@example.com/live?token=worker-token-secret',
        ];

        traceSqlStatement(
            'sql-worker',
            `INSERT INTO playlists (username, password, url) VALUES ('${secrets[0]}', '${secrets[1]}', '${secrets[2]}')`
        );

        const output = (console.log as jest.Mock).mock.calls.flat().join('\n');
        expect(output).toContain('"statementType":"INSERT"');
        expect(output).not.toContain('INSERT INTO');
        for (const secret of secrets) {
            expect(output).not.toContain(secret);
        }
    });
});

describe('startup phase counting', () => {
    const FLAGS = ['IPTVNATOR_PERF_CAPTURE', 'IPTVNATOR_TRACE_STARTUP'];
    const original = FLAGS.map((name) => [name, process.env[name]] as const);

    afterEach(() => {
        for (const [name, value] of original) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
        jest.restoreAllMocks();
        jest.resetModules();
    });

    async function runPhases(env: Record<string, string>) {
        for (const name of FLAGS) {
            delete process.env[name];
        }
        Object.assign(process.env, env);
        const log = jest.spyOn(console, 'log').mockImplementation(() => {
            /* silenced */
        });
        const payload = jest.fn(() => ({ source: 'did-start-loading' }));
        const { performanceCounters, traceStartupPhase } =
            await import('./debug-trace');

        traceStartupPhase('bootstrap-app');
        traceStartupPhase('deferred-events:start', payload);

        return {
            counters: performanceCounters.read().counters,
            lines: log.mock.calls.map((call) => String(call[0])),
            payload,
        };
    }

    it('neither counts nor traces nor builds payloads by default', async () => {
        const result = await runPhases({});

        expect(result.counters).toEqual({});
        expect(result.lines).toEqual([]);
        expect(result.payload).not.toHaveBeenCalled();
    });

    it('counts every phase with IPTVNATOR_PERF_CAPTURE=1 without tracing', async () => {
        const result = await runPhases({ IPTVNATOR_PERF_CAPTURE: '1' });

        expect(result.counters).toEqual({ 'main.startupPhases': 2 });
        expect(result.lines).toEqual([]);
        expect(result.payload).not.toHaveBeenCalled();
    });

    it('keeps the startup trace lines unchanged when tracing is on', async () => {
        const result = await runPhases({ IPTVNATOR_TRACE_STARTUP: '1' });

        expect(result.counters).toEqual({});
        expect(result.lines).toEqual([
            '[IPTVnator Trace][startup] bootstrap-app',
            '[IPTVnator Trace][startup] deferred-events:start {"source":"did-start-loading"}',
        ]);
    });
});

describe('SQL statement count opt-in', () => {
    const FLAGS = ['IPTVNATOR_PERF_CAPTURE', 'IPTVNATOR_PERF_COUNT_SQL'];
    const original = FLAGS.map((name) => [name, process.env[name]] as const);

    afterEach(() => {
        for (const [name, value] of original) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    });

    it.each([
        [{}, false],
        [{ IPTVNATOR_PERF_CAPTURE: '1' }, false],
        [{ IPTVNATOR_PERF_COUNT_SQL: '1' }, false],
        [{ IPTVNATOR_PERF_CAPTURE: '1', IPTVNATOR_PERF_COUNT_SQL: '1' }, true],
    ])('needs both flags: %j -> %s', async (env, expected) => {
        for (const name of FLAGS) {
            delete process.env[name];
        }
        Object.assign(process.env, env);
        const { isSqlStatementCountEnabled } = await import('./debug-trace');

        expect(isSqlStatementCountEnabled()).toBe(expected);
    });
});

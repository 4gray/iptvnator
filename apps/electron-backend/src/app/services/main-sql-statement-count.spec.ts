import Database from 'better-sqlite3';
import * as shared from '@iptvnator/shared/database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countMainProcessSqlStatements } from './main-sql-statement-count';
import { createPerformanceCounterRegistry } from './performance-counters';

const ENV_NAMES = ['IPTVNATOR_E2E_DATA_DIR', 'IPTVNATOR_TRACE_SQL'] as const;
const EXECUTION_METHODS = ['run', 'get', 'all', 'iterate'] as const;

describe('main-process SQL statement count', () => {
    const originalEnv = ENV_NAMES.map((name) => [name, process.env[name]]);
    const statementPrototype = (() => {
        const probe = new Database(':memory:');
        const prototype = Object.getPrototypeOf(
            probe.prepare('SELECT 1')
        ) as Record<string, unknown>;
        probe.close();
        return prototype;
    })();
    const originalMethods = EXECUTION_METHODS.map(
        (method) => [method, statementPrototype[method]] as const
    );
    let dataDirectory: string | null = null;

    afterEach(() => {
        for (const [method, original] of originalMethods) {
            statementPrototype[method] = original;
        }
        for (const [name, value] of originalEnv) {
            if (value === undefined) {
                delete process.env[name as string];
            } else {
                process.env[name as string] = value;
            }
        }
        if (dataDirectory) {
            rmSync(dataDirectory, { force: true, recursive: true });
            dataDirectory = null;
        }
        jest.restoreAllMocks();
    });

    it('registers no connection observer without the capture flag', () => {
        const setObserver = jest.fn();

        countMainProcessSqlStatements(
            createPerformanceCounterRegistry(() => true),
            false,
            setObserver
        );

        expect(setObserver).not.toHaveBeenCalled();
    });

    it('counts every statement of the shared connection, as the sql-main trace does', async () => {
        dataDirectory = mkdtempSync(join(tmpdir(), 'iptvnator-main-sql-'));
        process.env['IPTVNATOR_E2E_DATA_DIR'] = dataDirectory;
        process.env['IPTVNATOR_TRACE_SQL'] = '1';
        const log = jest.spyOn(console, 'log').mockImplementation(() => {
            /* silenced */
        });
        const registry = createPerformanceCounterRegistry(() => true);

        countMainProcessSqlStatements(
            registry,
            true,
            shared.setDatabaseConnectionObserver
        );
        try {
            await shared.initDatabase();
        } finally {
            shared.setDatabaseConnectionObserver(null);
            shared.closeDatabase();
        }

        const traced = log.mock.calls.filter((call) =>
            String(call[0]).startsWith('[IPTVnator Trace][sql-main] query')
        ).length;
        const counted = registry.read().counters['main.sqlStatements'];
        expect(traced).toBeGreaterThan(0);
        expect(counted).toBe(traced);
    });
});

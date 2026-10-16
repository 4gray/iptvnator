import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE } from './database-worker-sql-statement-count';

/**
 * Pins the worker wiring of `database-worker-sql-statement-count.ts`: with
 * IPTVNATOR_PERF_CAPTURE=1 and IPTVNATOR_PERF_COUNT_SQL=1 the real worker
 * connection reports its statements over the parent port, with the capture
 * flag alone (the import benchmarks) or without flags it reports nothing,
 * and the worker flushes the count before any response it posts.
 */
const ENV_NAMES = [
    'IPTVNATOR_PERF_CAPTURE',
    'IPTVNATOR_PERF_COUNT_SQL',
    'IPTVNATOR_E2E_DATA_DIR',
] as const;
const EXECUTION_METHODS = ['run', 'get', 'all', 'iterate'] as const;

describe('database worker SQL statement count wiring', () => {
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
    let ports: MessagePort[] = [];
    let dataDirectory: string | null = null;

    afterEach(() => {
        for (const port of ports) {
            port.close();
        }
        ports = [];
        // The connection wraps the shared Statement prototype; keep other
        // spec files in this Jest worker unaffected.
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
        jest.resetModules();
    });

    function connectPorts(): { messages: unknown[]; workerPort: MessagePort } {
        const channel = new MessageChannel();
        ports.push(channel.port1, channel.port2);
        const messages: unknown[] = [];
        channel.port2.on('message', (message) => messages.push(message));
        jest.doMock('worker_threads', () => ({
            ...jest.requireActual('worker_threads'),
            parentPort: channel.port1,
            workerData: {},
        }));
        return { messages, workerPort: channel.port1 };
    }

    async function openConnection(
        flags: Partial<Record<(typeof ENV_NAMES)[number], string>>,
        expectedMessages: number
    ) {
        dataDirectory = mkdtempSync(join(tmpdir(), 'iptvnator-sql-count-'));
        delete process.env['IPTVNATOR_PERF_CAPTURE'];
        delete process.env['IPTVNATOR_PERF_COUNT_SQL'];
        Object.assign(process.env, flags);
        process.env['IPTVNATOR_E2E_DATA_DIR'] = dataDirectory;
        const { messages } = connectPorts();
        const connection = await import('./database.worker-connection');
        await connection.getWorkerDatabase();
        connection.flushWorkerSqlStatementCount();
        connection.closeWorkerDatabase();
        // Port delivery is asynchronous: wait for the expected messages, and
        // a few more turns so an unexpected extra message is still seen.
        const deadline = Date.now() + 5_000;
        while (messages.length < expectedMessages && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        return messages;
    }

    it('reports the connection setup statements when SQL counting is on', async () => {
        const messages = await openConnection(
            { IPTVNATOR_PERF_CAPTURE: '1', IPTVNATOR_PERF_COUNT_SQL: '1' },
            2
        );

        // Seven PRAGMAs on open, then `PRAGMA optimize` on close.
        expect(messages).toEqual([
            { type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE, count: 7 },
            { type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE, count: 1 },
        ]);
        expect(JSON.stringify(messages)).not.toMatch(/PRAGMA|journal_mode/i);
    });

    it.each([
        ['without flags', {}],
        [
            'with the capture flag alone, as the import benchmarks run',
            { IPTVNATOR_PERF_CAPTURE: '1' },
        ],
    ])(
        'reports nothing and leaves better-sqlite3 alone %s',
        async (_label, flags) => {
            const messages = await openConnection(flags, 0);

            expect(messages).toEqual([]);
            for (const [method, original] of originalMethods) {
                expect(statementPrototype[method]).toBe(original);
            }
        }
    );

    it('flushes the count before the worker posts a response', async () => {
        const { messages, workerPort } = connectPorts();
        let pendingStatements = 0;
        jest.doMock('./database.worker-connection', () => ({
            closeWorkerDatabase: jest.fn(),
            flushWorkerSqlStatementCount: jest.fn(() => {
                if (pendingStatements > 0) {
                    workerPort.postMessage({
                        type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE,
                        count: pendingStatements,
                    });
                    pendingStatements = 0;
                }
            }),
            getWorkerDatabase: jest.fn(async () => {
                pendingStatements = 2;
                return {};
            }),
        }));
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await import('./database.worker');
        ports[1].postMessage({
            type: 'request',
            operation: 'DB_GET_APP_STATE',
            payload: { key: 'sql-count-wiring' },
            requestId: 'request-sql-count',
        });
        const deadline = Date.now() + 5_000;
        while (
            !messages.some(
                (message) => (message as { type?: string }).type === 'response'
            )
        ) {
            if (Date.now() > deadline) {
                throw new Error('database worker did not respond');
            }
            await new Promise((resolve) => setTimeout(resolve, 5));
        }

        expect(
            messages.map((message) => (message as { type: string }).type)
        ).toEqual(['ready', DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE, 'response']);
    });
});

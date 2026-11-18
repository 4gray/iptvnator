import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * In-process coverage of how initDatabase() forgets a failed attempt. The
 * real-SQLite behaviour is covered under Electron in connection-retry.spec.ts;
 * here better-sqlite3 is replaced so each failure branch can be forced.
 */
interface FakeConnection {
    open: boolean;
    pragma: jest.Mock;
    close: jest.Mock;
}

type Behaviour = 'open-throws' | 'pragma-throws' | 'close-throws' | 'ok';

const behaviours: Behaviour[] = [];
const connections: FakeConnection[] = [];

jest.mock('better-sqlite3', () => ({
    __esModule: true,
    default: jest.fn(() => {
        const behaviour = behaviours.shift() ?? 'ok';
        if (behaviour === 'open-throws') {
            throw new Error('unable to open database file');
        }
        const connection: FakeConnection = {
            open: true,
            pragma: jest.fn((statement: string) => {
                if (
                    behaviour !== 'ok' &&
                    statement.startsWith('foreign_keys')
                ) {
                    throw new Error('file is not a database');
                }
            }),
            close: jest.fn(() => {
                connection.open = false;
                if (behaviour === 'close-throws') {
                    throw new Error('close failed');
                }
            }),
        };
        connections.push(connection);
        return connection;
    }),
}));

import { closeDatabase, getDatabase, initDatabase } from './connection';

const readOnly = { readonly: true, skipTableCreation: true };

describe('initDatabase after a failed attempt', () => {
    let dataDir: string;
    const previousDataDir = process.env['IPTVNATOR_E2E_DATA_DIR'];

    beforeEach(() => {
        dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-init-failure-'));
        process.env['IPTVNATOR_E2E_DATA_DIR'] = dataDir;
        behaviours.length = 0;
        connections.length = 0;
    });

    afterEach(() => {
        closeDatabase();
        if (previousDataDir === undefined) {
            delete process.env['IPTVNATOR_E2E_DATA_DIR'];
        } else {
            process.env['IPTVNATOR_E2E_DATA_DIR'] = previousDataDir;
        }
        rmSync(dataDir, { recursive: true, force: true });
    });

    it('gives every caller of a failed open its rejection, then opens again', async () => {
        behaviours.push('open-throws');

        const first = initDatabase(readOnly);
        const concurrent = getDatabase(readOnly);

        await expect(first).rejects.toThrow('unable to open database file');
        await expect(concurrent).rejects.toBe(
            await first.catch((error: unknown) => error)
        );
        const database = await getDatabase(readOnly);
        expect(database).toBeDefined();
        expect(connections).toHaveLength(1);
        await expect(initDatabase(readOnly)).resolves.toBe(database);
    });

    it('closes the half-open handle a failed pragma leaves', async () => {
        behaviours.push('pragma-throws');

        await expect(initDatabase(readOnly)).rejects.toThrow(
            'file is not a database'
        );

        expect(connections[0].close).toHaveBeenCalledTimes(1);
        await expect(getDatabase(readOnly)).resolves.toBeDefined();
        expect(connections).toHaveLength(2);
    });

    it('still forgets the attempt when closing the half-open handle throws', async () => {
        behaviours.push('close-throws');

        await expect(initDatabase(readOnly)).rejects.toThrow(
            'file is not a database'
        );

        await expect(getDatabase(readOnly)).resolves.toBeDefined();
        expect(connections).toHaveLength(2);
    });

    it('leaves state alone when closeDatabase() already ran for the attempt', async () => {
        behaviours.push('pragma-throws');

        const attempt = initDatabase(readOnly);
        closeDatabase();
        await expect(attempt).rejects.toThrow('file is not a database');

        expect(connections[0].close).toHaveBeenCalledTimes(1);
        await expect(getDatabase(readOnly)).resolves.toBeDefined();
    });
});

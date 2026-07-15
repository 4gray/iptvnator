import { closeSync, mkdtempSync, openSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secureDatabaseFilePermissions } from './database-file-permissions';

describe('secureDatabaseFilePermissions', () => {
    it('restricts the database, WAL, and shared-memory files on POSIX', () => {
        if (process.platform === 'win32') return;
        const directory = mkdtempSync(join(tmpdir(), 'iptvnator-db-mode-'));
        const databasePath = join(directory, 'iptvnator.db');
        for (const filePath of [
            databasePath,
            `${databasePath}-wal`,
            `${databasePath}-shm`,
        ]) {
            closeSync(openSync(filePath, 'w', 0o666));
        }

        try {
            secureDatabaseFilePermissions(databasePath);
            for (const filePath of [
                databasePath,
                `${databasePath}-wal`,
                `${databasePath}-shm`,
            ]) {
                expect(statSync(filePath).mode & 0o777).toBe(0o600);
            }
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});

import { chmodSync, existsSync } from 'node:fs';

/** Keep SQLite data and transient WAL files private on multi-user systems. */
export function secureDatabaseFilePermissions(filePath: string): void {
    if (process.platform === 'win32') {
        return;
    }

    for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
        if (existsSync(candidate)) {
            chmodSync(candidate, 0o600);
        }
    }
}

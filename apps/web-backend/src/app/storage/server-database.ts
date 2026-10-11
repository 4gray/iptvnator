import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import {
    appState,
    closeDatabase,
    getDatabasePath,
    initDatabase,
    type DatabaseInstance,
} from '@iptvnator/shared/database';
import { SERVER_USER_STATE_TABLE_SQL } from './server-user-state.table';

const INSTANCE_ID_KEY = 'server:instance-id';

export interface ServerDatabase {
    readonly db: DatabaseInstance;
    readonly instanceId: string;
    readonly path: string;
    sizeBytes(): number;
    close(): void;
}

/**
 * Opens the shared IPTVnator database (full schema and migrations, the
 * same as the desktop app) and adds the server-only table. The path comes
 * from `IPTVNATOR_DATA_DIR`.
 */
export async function openServerDatabase(): Promise<ServerDatabase> {
    const db = await initDatabase();
    db.run(sql.raw(SERVER_USER_STATE_TABLE_SQL));
    const path = getDatabasePath();

    return {
        db,
        instanceId: ensureInstanceId(db),
        path,
        sizeBytes: () => fileSize(path) + fileSize(`${path}-wal`),
        close: () => closeDatabase(),
    };
}

function ensureInstanceId(db: DatabaseInstance): string {
    const existing = db
        .select({ value: appState.value })
        .from(appState)
        .where(eq(appState.key, INSTANCE_ID_KEY))
        .get();
    if (existing?.value) {
        return existing.value;
    }

    const instanceId = randomUUID();
    db.insert(appState)
        .values({
            key: INSTANCE_ID_KEY,
            value: instanceId,
            updatedAt: new Date().toISOString(),
        })
        .run();
    return instanceId;
}

function fileSize(path: string): number {
    try {
        return statSync(path).size;
    } catch {
        return 0;
    }
}

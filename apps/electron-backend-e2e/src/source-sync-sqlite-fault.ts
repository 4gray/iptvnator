import type { ElectronApplication } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Fail real parental-store writes without preventing playlist deletion. */
export function setSourceCleanupWriteFailure(
    app: ElectronApplication,
    directory: string,
    instanceId: string,
    enabled: boolean
): Promise<void> {
    return app.evaluate(
        (_electron, { dependency, file, enabled }) => {
            const Database = process
                .getBuiltinModule('module')
                .createRequire(dependency)(dependency);
            const db = new Database(file);
            try {
                db.pragma('busy_timeout = 5000');
                db.exec(
                    'DROP TRIGGER IF EXISTS synthetic_sync_cleanup_insert; DROP TRIGGER IF EXISTS synthetic_sync_cleanup_update;'
                );
                if (enabled)
                    db.exec(`
                CREATE TRIGGER synthetic_sync_cleanup_insert BEFORE INSERT ON app_state
                WHEN NEW.key = 'parental-lock:locks' BEGIN SELECT RAISE(ABORT, 'synthetic cleanup failure'); END;
                CREATE TRIGGER synthetic_sync_cleanup_update BEFORE UPDATE ON app_state
                WHEN NEW.key = 'parental-lock:locks' BEGIN SELECT RAISE(ABORT, 'synthetic cleanup failure'); END;
            `);
            } finally {
                db.close();
            }
        },
        {
            dependency: join(workspaceRoot, 'node_modules/better-sqlite3'),
            file: join(
                directory,
                'server-profiles',
                createHash('sha256').update(instanceId).digest('hex'),
                'databases',
                'iptvnator.db'
            ),
            enabled,
        }
    );
}

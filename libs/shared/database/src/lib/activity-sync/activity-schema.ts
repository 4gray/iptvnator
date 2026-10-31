import type Database from 'better-sqlite3';

/** Opt-in initialization only. No existing playlists, positions or legacy maps are touched. */
export function ensureActivitySchema(database: Database.Database): void {
    database.transaction(() => {
        database.exec(`
            CREATE TABLE IF NOT EXISTS activity_local_records (
                address_key TEXT PRIMARY KEY NOT NULL,
                instance_id TEXT NOT NULL,
                pending_count INTEGER NOT NULL,
                address TEXT NOT NULL,
                source_id TEXT NOT NULL,
                value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS activity_local_pending
                ON activity_local_records (instance_id) WHERE pending_count > 0;
            CREATE TABLE IF NOT EXISTS activity_server_states (
                address_key TEXT PRIMARY KEY NOT NULL,
                address TEXT NOT NULL,
                instance_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                source_incarnation TEXT NOT NULL,
                value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS activity_server_source ON activity_server_states
                (instance_id, source_id, source_incarnation, address_key);
            CREATE TABLE IF NOT EXISTS activity_server_receipts (
                receipt_key TEXT PRIMARY KEY NOT NULL,
                command TEXT NOT NULL,
                result TEXT NOT NULL
            );
        `);
    })();
}

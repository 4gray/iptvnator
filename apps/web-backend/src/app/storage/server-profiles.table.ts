/**
 * Server-only table: the people of a household. Created by
 * `openServerDatabase`, never by the desktop app. The Default profile
 * (id `default`, scope `'shared'`) has a row only once it is renamed,
 * recoloured or given a PIN. `household_id` leaves room for several
 * households on one server; today every row belongs to `default`.
 */
export const SERVER_PROFILES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS server_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    colour TEXT NOT NULL,
    pin_hash TEXT,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)`;

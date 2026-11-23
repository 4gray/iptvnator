/**
 * Server-only table: the people of a household. Created by
 * `openServerDatabase`, never by the desktop app. The Default profile
 * (id `default`, scope `'shared'`) has a row only once it is renamed,
 * recoloured or given a PIN. `household_id` leaves room for several
 * households on one server; today every row belongs to `default`. The key
 * is `(household_id, id)`, so each household can have its own Default row.
 * The table never shipped with an `id`-only key, so nothing is migrated.
 */
export const SERVER_PROFILES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS server_profiles (
    id TEXT NOT NULL,
    household_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    colour TEXT NOT NULL,
    emoji TEXT,
    pin_hash TEXT,
    kids INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (household_id, id)
)`;

/**
 * Server-only table: per-household profile settings. No row means profiles
 * are off and the list is at revision 0, as on a server that never had them.
 */
export const SERVER_PROFILE_HOUSEHOLDS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS server_profile_households (
    household_id TEXT PRIMARY KEY NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
)`;

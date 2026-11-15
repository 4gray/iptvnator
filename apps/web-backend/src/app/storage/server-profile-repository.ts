import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
    DEFAULT_PERSONAL_SCOPE,
    DEFAULT_PROFILE_ID,
    isProfileId,
    profileIdOfScope,
    profileScope,
    type PersonalScope,
    type ServerProfile,
} from '@iptvnator/shared/interfaces/profiles';

const HOUSEHOLD = 'default';
const DEFAULT_NAME = 'Default';
/** Colours given in turn to new profiles that do not choose one. */
export const PROFILE_COLOURS = [
    '#3b82f6',
    '#ef4444',
    '#22c55e',
    '#f59e0b',
    '#a855f7',
    '#14b8a6',
    '#ec4899',
    '#64748b',
] as const;

interface ProfileRow {
    id: string;
    name: string;
    colour: string;
    pin_hash: string | null;
    sort_order: number;
}

/** What a profile change may set. `pinHash: null` removes the PIN. */
export interface ProfileChanges {
    readonly name?: string;
    readonly colour?: string;
    readonly pinHash?: string | null;
}

/**
 * The household's profiles. Personal state itself stays in the activity,
 * favorites and history stores, keyed by each profile's scope.
 */
export class ServerProfileRepository {
    constructor(private readonly sqlite: Database.Database) {}

    list(): ServerProfile[] {
        const rows = this.sqlite
            .prepare(
                `SELECT id, name, colour, pin_hash, sort_order FROM server_profiles
                 WHERE household_id = ? AND id != ? ORDER BY sort_order, created_at`
            )
            .all(HOUSEHOLD, DEFAULT_PROFILE_ID) as ProfileRow[];
        return [this.defaultProfile(), ...rows.map(toProfile)];
    }

    get(id: string): ServerProfile | null {
        if (id === DEFAULT_PROFILE_ID) return this.defaultProfile();
        const row = this.row(id);
        return row ? toProfile(row) : null;
    }

    /** Whether a personal scope belongs to a profile that exists. */
    hasScope(scope: PersonalScope): boolean {
        const id = profileIdOfScope(scope);
        return id === null || this.row(id) !== null;
    }

    pinHashOf(id: string): string | null {
        return this.row(id)?.pin_hash ?? null;
    }

    nameTaken(name: string, exceptId?: string): boolean {
        const folded = name.toLocaleLowerCase();
        return this.list().some(
            (p) => p.id !== exceptId && p.name.toLocaleLowerCase() === folded
        );
    }

    count(): number {
        return this.list().length;
    }

    create(name: string, colour: string | undefined, pinHash: string | null) {
        const id = randomUUID();
        const now = new Date().toISOString();
        const order = this.list().length;
        this.sqlite
            .prepare(
                `INSERT INTO server_profiles (id, household_id, name, colour, pin_hash, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                id,
                HOUSEHOLD,
                name,
                colour ?? PROFILE_COLOURS[order % PROFILE_COLOURS.length],
                pinHash,
                order,
                now,
                now
            );
        return this.get(id) as ServerProfile;
    }

    /** Updates a profile; the Default profile gets its row on its first change. */
    update(id: string, changes: ProfileChanges): ServerProfile | null {
        const current = this.get(id);
        if (!current) return null;
        const now = new Date().toISOString();
        const pinHash =
            changes.pinHash === undefined
                ? this.pinHashOf(id)
                : changes.pinHash;
        this.sqlite
            .prepare(
                `INSERT INTO server_profiles (id, household_id, name, colour, pin_hash, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, colour = excluded.colour,
                     pin_hash = excluded.pin_hash, updated_at = excluded.updated_at`
            )
            .run(
                id,
                HOUSEHOLD,
                changes.name ?? current.name,
                changes.colour ?? current.colour,
                pinHash,
                current.sortOrder,
                now,
                now
            );
        return this.get(id);
    }

    /**
     * Deletes a profile and everything stored under its scope, in one
     * transaction. The Default profile cannot be deleted.
     */
    delete(id: string): boolean {
        if (!isProfileId(id) || !this.row(id)) return false;
        const scope = profileScope(id);
        this.sqlite.transaction(() => {
            this.sqlite
                .prepare('DELETE FROM server_profiles WHERE id = ?')
                .run(id);
            for (const [table, where] of STATE_TABLES) {
                if (this.tableExists(table)) {
                    this.sqlite
                        .prepare(`DELETE FROM ${table} WHERE ${where} = ?`)
                        .run(scope);
                }
            }
        })();
        return true;
    }

    private defaultProfile(): ServerProfile {
        const row = this.row(DEFAULT_PROFILE_ID);
        return {
            id: DEFAULT_PROFILE_ID,
            scope: DEFAULT_PERSONAL_SCOPE,
            name: row?.name ?? DEFAULT_NAME,
            colour: row?.colour ?? PROFILE_COLOURS[0],
            hasPin: !!row?.pin_hash,
            sortOrder: -1,
        };
    }

    private row(id: string): ProfileRow | null {
        return (
            (this.sqlite
                .prepare(
                    'SELECT id, name, colour, pin_hash, sort_order FROM server_profiles WHERE id = ? AND household_id = ?'
                )
                .get(id, HOUSEHOLD) as ProfileRow | undefined) ?? null
        );
    }

    private tableExists(table: string): boolean {
        return !!this.sqlite
            .prepare(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
            )
            .get(table);
    }
}

/**
 * Where each store keeps the scope. Activity and favorites store the
 * address as JSON and put the scope second in their receipt keys; history
 * appends it to its scope key, fifth, only for profiles other than Default.
 */
const STATE_TABLES: readonly (readonly [string, string])[] = [
    ['activity_server_states', "json_extract(address, '$.scope')"],
    ['activity_server_receipts', "json_extract(receipt_key, '$[1]')"],
    ['favorite_server_states', "json_extract(address, '$.scope')"],
    ['favorite_server_receipts', "json_extract(receipt_key, '$[1]')"],
    ['history_server_states', "json_extract(scope_key, '$[4]')"],
    ['history_server_receipts', "json_extract(scope_key, '$[4]')"],
];

function toProfile(row: ProfileRow): ServerProfile {
    return {
        id: row.id,
        scope: profileScope(row.id),
        name: row.name,
        colour: row.colour,
        hasPin: !!row.pin_hash,
        sortOrder: row.sort_order,
    };
}

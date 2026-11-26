import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
    DEFAULT_PERSONAL_SCOPE,
    DEFAULT_PROFILE_ID,
    isProfileId,
    PROFILE_COLOURS,
    profileIdOfScope,
    profileScope,
    type PersonalScope,
    type ServerProfile,
    type ServerProfileList,
} from '@iptvnator/shared/interfaces/profiles';
import { ServerProfileHousehold } from './server-profile-household';

/** The only household until a household level is added above profiles. */
export const DEFAULT_HOUSEHOLD_ID = 'default';
const DEFAULT_NAME = 'Default';

interface ProfileRow {
    id: string;
    name: string;
    colour: string;
    emoji: string | null;
    pin_hash: string | null;
    kids: number;
    sort_order: number;
}

/** A new profile; the colour is picked for it when absent. */
export interface NewProfile {
    readonly name: string;
    readonly colour?: string;
    readonly emoji?: string;
    readonly pinHash: string | null;
    readonly kids?: boolean;
}

/** What a profile change may set. `pinHash: null` removes the PIN. */
export interface ProfileChanges {
    readonly name?: string;
    readonly colour?: string;
    /** `null` removes the emoji. */
    readonly emoji?: string | null;
    readonly pinHash?: string | null;
    readonly kids?: boolean;
}

/**
 * The household's profiles. Personal state itself stays in the activity,
 * favorites and history stores, keyed by each profile's scope.
 */
export class ServerProfileRepository {
    readonly household: ServerProfileHousehold;

    constructor(
        private readonly sqlite: Database.Database,
        private readonly householdId = DEFAULT_HOUSEHOLD_ID
    ) {
        this.household = new ServerProfileHousehold(sqlite, householdId);
    }

    /** What `GET /v1/profiles` returns. */
    snapshot(): ServerProfileList {
        return {
            enabled: this.household.enabled(),
            revision: this.household.revision(),
            profiles: this.list(),
        };
    }

    list(): ServerProfile[] {
        const rows = this.sqlite
            .prepare(
                `SELECT id, name, colour, emoji, pin_hash, kids, sort_order FROM server_profiles
                 WHERE household_id = ? AND id != ? ORDER BY sort_order, created_at`
            )
            .all(this.householdId, DEFAULT_PROFILE_ID) as ProfileRow[];
        return [this.defaultProfile(), ...rows.map(toProfile)];
    }

    get(id: string): ServerProfile | null {
        if (id === DEFAULT_PROFILE_ID) return this.defaultProfile();
        const row = this.row(id);
        return row ? toProfile(row) : null;
    }

    /**
     * Whether a personal scope belongs to a profile that exists. Ignores the
     * household switch; the scope guard checks that separately.
     */
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

    create({ name, colour, emoji, pinHash, kids = false }: NewProfile) {
        const id = randomUUID();
        const now = new Date().toISOString();
        // After a deletion the count would repeat an order and a colour.
        const order = this.nextSortOrder();
        const used = new Set(this.list().map((p) => p.colour));
        const pick = (
            PROFILE_COLOURS.find(({ hex }) => !used.has(hex)) ??
            PROFILE_COLOURS[order % PROFILE_COLOURS.length]
        ).hex;
        this.sqlite.transaction(() => {
            this.sqlite
                .prepare(
                    `INSERT INTO server_profiles (id, household_id, name, colour, emoji, pin_hash, kids, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                    id,
                    this.householdId,
                    name,
                    colour ?? pick,
                    emoji ?? null,
                    pinHash,
                    kids ? 1 : 0,
                    order,
                    now,
                    now
                );
            this.household.touch();
        })();
        return this.get(id) as ServerProfile;
    }

    /**
     * Sets the order of the profiles other than Default, which stays first.
     * `ids` must name each of them once; returns false otherwise.
     */
    reorder(ids: readonly string[]): boolean {
        const current = this.list()
            .map((p) => p.id)
            .filter((id) => id !== DEFAULT_PROFILE_ID);
        const wanted = new Set(ids);
        if (
            ids.length !== current.length ||
            wanted.size !== ids.length ||
            current.some((id) => !wanted.has(id))
        ) {
            return false;
        }
        const move = this.sqlite.prepare(
            'UPDATE server_profiles SET sort_order = ? WHERE household_id = ? AND id = ?'
        );
        this.sqlite.transaction(() => {
            ids.forEach((id, index) => move.run(index, this.householdId, id));
            this.household.touch();
        })();
        return true;
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
        this.sqlite.transaction(() => {
            this.sqlite
                .prepare(
                    `INSERT INTO server_profiles (id, household_id, name, colour, emoji, pin_hash, kids, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(household_id, id) DO UPDATE SET name = excluded.name, colour = excluded.colour,
                     emoji = excluded.emoji,
                     pin_hash = excluded.pin_hash, kids = excluded.kids, updated_at = excluded.updated_at`
                )
                .run(
                    id,
                    this.householdId,
                    changes.name ?? current.name,
                    changes.colour ?? current.colour,
                    changes.emoji === undefined
                        ? (current.emoji ?? null)
                        : changes.emoji,
                    pinHash,
                    (changes.kids ?? current.kids) ? 1 : 0,
                    current.sortOrder,
                    now,
                    now
                );
            this.household.touch();
        })();
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
                .prepare(
                    'DELETE FROM server_profiles WHERE household_id = ? AND id = ?'
                )
                .run(this.householdId, id);
            this.household.touch();
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

    private nextSortOrder(): number {
        const { next } = this.sqlite
            .prepare(
                `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM server_profiles
                 WHERE household_id = ? AND id != ?`
            )
            .get(this.householdId, DEFAULT_PROFILE_ID) as { next: number };
        return next;
    }

    private defaultProfile(): ServerProfile {
        const row = this.row(DEFAULT_PROFILE_ID);
        return {
            id: DEFAULT_PROFILE_ID,
            scope: DEFAULT_PERSONAL_SCOPE,
            name: row?.name ?? DEFAULT_NAME,
            colour: row?.colour ?? PROFILE_COLOURS[0].hex,
            ...(row?.emoji ? { emoji: row.emoji } : {}),
            hasPin: !!row?.pin_hash,
            kids: !!row?.kids,
            sortOrder: -1,
        };
    }

    private row(id: string): ProfileRow | null {
        return (
            (this.sqlite
                .prepare(
                    'SELECT id, name, colour, emoji, pin_hash, kids, sort_order FROM server_profiles WHERE id = ? AND household_id = ?'
                )
                .get(id, this.householdId) as ProfileRow | undefined) ?? null
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
        ...(row.emoji ? { emoji: row.emoji } : {}),
        hasPin: !!row.pin_hash,
        kids: !!row.kids,
        sortOrder: row.sort_order,
    };
}

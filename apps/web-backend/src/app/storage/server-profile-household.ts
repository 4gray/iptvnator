import type Database from 'better-sqlite3';

interface HouseholdRow {
    enabled: number;
    revision: number;
}

/**
 * Whether profiles are on for a household, and the revision of its profile
 * list. Every change to the list or the switch moves the revision, so a
 * client can tell from it whether its copy is current.
 */
export class ServerProfileHousehold {
    constructor(
        private readonly sqlite: Database.Database,
        readonly id: string
    ) {}

    enabled(): boolean {
        return !!this.row()?.enabled;
    }

    revision(): number {
        return this.row()?.revision ?? 0;
    }

    /** Turns profiles on or off. Nothing is deleted either way. */
    setEnabled(enabled: boolean): void {
        if (this.enabled() === enabled) return;
        this.sqlite
            .prepare(
                `INSERT INTO server_profile_households (household_id, enabled, revision, updated_at)
                 VALUES (?, ?, 1, ?)
                 ON CONFLICT(household_id) DO UPDATE SET enabled = excluded.enabled,
                     revision = revision + 1, updated_at = excluded.updated_at`
            )
            .run(this.id, enabled ? 1 : 0, new Date().toISOString());
    }

    /** Moves the revision after a change to the profile list. */
    touch(): void {
        this.sqlite
            .prepare(
                `INSERT INTO server_profile_households (household_id, revision, updated_at)
                 VALUES (?, 1, ?)
                 ON CONFLICT(household_id) DO UPDATE SET
                     revision = revision + 1, updated_at = excluded.updated_at`
            )
            .run(this.id, new Date().toISOString());
    }

    private row(): HouseholdRow | null {
        return (
            (this.sqlite
                .prepare(
                    'SELECT enabled, revision FROM server_profile_households WHERE household_id = ?'
                )
                .get(this.id) as HouseholdRow | undefined) ?? null
        );
    }
}

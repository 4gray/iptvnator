import { Injectable, inject, signal } from '@angular/core';
import { SourceHealthEvidenceService } from '@iptvnator/services';
import {
    SourceHealthHistoryEntry,
    SourceHealthSnapshot,
} from '@iptvnator/shared/interfaces';
import { isSourceHealthReason } from './source-health-identity';
import {
    nextSourceHealthHistory,
    sourceReachabilityFromHealth,
} from './source-reachability';

export const SOURCE_HEALTH_HISTORY_STORAGE_KEY = 'source-health:history:v1';

function readHistory(): Map<string, SourceHealthHistoryEntry> {
    try {
        const raw = localStorage.getItem(SOURCE_HEALTH_HISTORY_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object') {
            return new Map();
        }
        const entries = new Map<string, SourceHealthHistoryEntry>();
        for (const [id, entry] of Object.entries(
            parsed as Record<string, SourceHealthHistoryEntry>
        )) {
            if (
                typeof entry?.checkedAt !== 'number' ||
                !['ok', 'bad', 'expired'].includes(entry.state)
            ) {
                continue;
            }
            // A reason this build cannot describe would show as a raw key.
            const { reason, connection, ...rest } = entry;
            entries.set(id, {
                ...rest,
                ...(isSourceHealthReason(reason) ? { reason } : {}),
                ...(typeof connection === 'string' ? { connection } : {}),
            });
        }
        return entries;
    } catch {
        return new Map();
    }
}

function toRecord(
    entries: ReadonlyMap<string, SourceHealthHistoryEntry>
): Record<string, SourceHealthHistoryEntry> {
    const record: Record<string, SourceHealthHistoryEntry> = {};
    entries.forEach((entry, id) => (record[id] = entry));
    return record;
}

/**
 * The last conclusive health result of each source, by playlist ID, kept
 * across restarts. Live checks stay in memory (`SourceHealthService`); this
 * keeps only what a list needs before they run again: the state, when it
 * was checked, since when a source has failed and why, and a fingerprint
 * of the connection checked. No URL or credential is stored, so the
 * entries need no redaction.
 */
@Injectable({ providedIn: 'root' })
export class SourceHealthHistoryService {
    private readonly state =
        signal<ReadonlyMap<string, SourceHealthHistoryEntry>>(readHistory());
    readonly entries = this.state.asReadonly();

    constructor() {
        inject(SourceHealthEvidenceService).connections.subscribe(
            ({ id, playlist }) => {
                if (!id) {
                    this.write(new Map());
                } else if (!playlist) {
                    this.forget(id);
                }
            }
        );
    }

    /**
     * @param connection Fingerprint of the checked connection
     * (`fingerprintSourceHealthKey`); a result for another connection than
     * the kept one starts the history over.
     */
    record(
        ids: readonly string[],
        snapshot: SourceHealthSnapshot,
        connection?: string
    ): void {
        const reachability = sourceReachabilityFromHealth(snapshot);
        const next = new Map(this.state());
        let changed = false;
        for (const id of ids) {
            const previous = next.get(id);
            const entry = nextSourceHealthHistory(
                previous,
                reachability,
                snapshot.checkedAt,
                { reason: snapshot.reason, connection }
            );
            if (entry && entry !== previous) {
                next.set(id, entry);
                changed = true;
            }
        }
        if (changed) {
            this.write(next);
        }
    }

    forget(id: string): void {
        if (!this.state().has(id)) {
            return;
        }
        const next = new Map(this.state());
        next.delete(id);
        this.write(next);
    }

    private write(next: Map<string, SourceHealthHistoryEntry>): void {
        this.state.set(next);
        try {
            localStorage.setItem(
                SOURCE_HEALTH_HISTORY_STORAGE_KEY,
                JSON.stringify(toRecord(next))
            );
        } catch {
            // The history is a convenience; the live checks still work.
        }
    }
}

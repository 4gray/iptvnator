import type {
    ActivityAddress,
    ActivityLocalRecord,
    ActivityPendingOperation,
    ActivityState,
} from './activity-sync.contract';
import {
    activityAddressKey,
    assertActivityToken,
} from './activity-sync.identity';

/** Storage implementations call this inside the same transaction as the write. */
export function assertActivityLocalRecord(
    address: ActivityAddress,
    record: ActivityLocalRecord
): void {
    if (!record?.state || !Array.isArray(record.pending)) {
        throw new Error('Invalid local activity record');
    }
    const key = activityAddressKey(address);
    const ids = new Set<string>();
    for (const pending of record.pending) {
        if (activityAddressKey(pending.address) !== key) {
            throw new Error('Activity outbox address mismatch');
        }
        assertActivityToken(pending.consentGeneration);
        assertActivityToken(pending.operation.operationId);
        assertActivityToken(pending.operation.deviceId);
        const id = JSON.stringify([
            pending.operation.deviceId,
            pending.operation.operationId,
        ]);
        if (ids.has(id)) throw new Error('Duplicate activity outbox operation');
        ids.add(id);
    }
}

/** Local storage boundary: caller supplies a synchronous, side-effect-free mutation. */
export interface ActivityLocalStore {
    entries(
        sourceId: string
    ): Promise<{ address: ActivityAddress; record: ActivityLocalRecord }[]>;
    read(address: ActivityAddress): Promise<ActivityLocalRecord | null>;
    /** Recover queued intents after restart; caller filters by current consent before sending. */
    pending(): Promise<ActivityPendingOperation[]>;
    mutate(
        address: ActivityAddress,
        change: (current: ActivityLocalRecord | null) => ActivityLocalRecord
    ): Promise<ActivityLocalRecord>;
}

/** No coalescing here: reset/mark/begin ordering is preserved, including across crashes. */
export function appendActivityIntent(
    current: ActivityLocalRecord | null,
    state: ActivityState,
    pending: ActivityPendingOperation
): ActivityLocalRecord {
    const next = { state, pending: [...(current?.pending ?? []), pending] };
    assertActivityLocalRecord(pending.address, next);
    return next;
}

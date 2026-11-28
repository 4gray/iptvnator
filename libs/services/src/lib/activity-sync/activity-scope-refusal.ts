import type { ActivityAddress } from '@iptvnator/shared/interfaces/activity-sync';
import type { ScopeRefusal } from '../profiles/scope-refusal';
import type { ActivitySyncClient } from './activity-sync-client';

/** A failed activity request; `refusal` is set when the server refused the profile scope itself. */
export class ActivityRequestError extends Error {
    constructor(readonly refusal: ScopeRefusal | null = null) {
        super('Activity request failed');
    }
}

/**
 * One scope's refusal never stops the others. A deleted profile's queue is
 * dropped with it; a switched-off scope keeps its queue, released for a later
 * pass.
 */
export async function parkRefusedActivity(
    client: ActivitySyncClient,
    address: ActivityAddress,
    refusal: ScopeRefusal
): Promise<void> {
    const dropped: string[] = [];
    await client.store.mutate(address, (current) => {
        if (!current) throw new Error('Activity outbox disappeared');
        dropped.length = 0;
        if (refusal === 'profile_missing') {
            for (const { operation } of current.pending)
                dropped.push(operation.operationId);
            return { ...current, pending: [] };
        }
        return {
            ...current,
            pending: current.pending.map((intent) => {
                const released = { ...intent };
                delete released.deliveryLease;
                return released;
            }),
        };
    });
    for (const id of dropped) client.delivery.settled(id);
}

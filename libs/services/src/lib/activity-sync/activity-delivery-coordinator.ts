import { createRandomId } from '@iptvnator/shared/interfaces';
import type {
    ActivityAddress,
    ActivityLocalRecord,
    ActivityPendingOperation,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { ActivitySyncClient } from './activity-sync-client';

/** Local-only leases protect live intent, never authorize recovered offline rebases. */
export const ACTIVITY_DELIVERY_LEASE_MS = 15_000;

class DeferredActivityDelivery extends Error {
    constructor(readonly record: ActivityLocalRecord | null) {
        super('Activity delivery deferred');
    }
}

export class ActivityDeliveryCoordinator {
    readonly owner = createRandomId();
    readonly begins = new Map<string, string>();
    readonly checkpoints = new Map<string, string>();
    private timer?: ReturnType<typeof setInterval>;
    constructor(private readonly client: ActivitySyncClient) {}

    lease() {
        return {
            owner: this.owner,
            expiresAt: Date.now() + ACTIVITY_DELIVERY_LEASE_MS,
        };
    }
    live(intent: ActivityPendingOperation): boolean {
        const remaining = (intent.deliveryLease?.expiresAt ?? 0) - Date.now();
        return remaining > 0 && remaining <= ACTIVITY_DELIVERY_LEASE_MS;
    }
    foreign(intent: ActivityPendingOperation): boolean {
        return (
            !!intent.deliveryLease &&
            intent.deliveryLease.owner !== this.owner &&
            this.live(intent)
        );
    }
    fresh(intent: ActivityPendingOperation): boolean {
        return (
            intent.deliveryLease?.owner === this.owner &&
            intent.consentGeneration === this.client.options.consent() &&
            this.live(intent) &&
            (this.begins.get(intent.operation.operationId) ??
                this.checkpoints.get(intent.operation.operationId)) ===
                intent.consentGeneration
        );
    }
    /** Claim the head in the store transaction, rather than trusting a stale list snapshot. */
    async claim(
        address: ActivityAddress,
        id: string
    ): Promise<{ allowed: boolean; record: ActivityLocalRecord | null }> {
        let fresh = false;
        try {
            const record = await this.client.store.mutate(
                address,
                (current) => {
                    const head = current?.pending[0];
                    if (
                        !current ||
                        current.conflict ||
                        head?.operation.operationId !== id ||
                        this.foreign(head)
                    )
                        throw new DeferredActivityDelivery(current);
                    fresh = this.fresh(head);
                    return {
                        ...current,
                        pending: [
                            { ...head, deliveryLease: this.lease() },
                            ...current.pending.slice(1),
                        ],
                    };
                }
            );
            if (fresh) this.start();
            else this.settled(id);
            return { allowed: true, record };
        } catch (error) {
            if (error instanceof DeferredActivityDelivery)
                return { allowed: false, record: error.record };
            throw error;
        }
    }
    start(): void {
        if (this.timer || (!this.begins.size && !this.checkpoints.size)) return;
        this.timer = setInterval(
            () => void this.update(true).catch(() => this.stop()),
            5000
        );
    }
    settled(id: string): void {
        this.begins.delete(id);
        this.checkpoints.delete(id);
        if (!this.begins.size && !this.checkpoints.size) this.stop();
    }
    private stop(): void {
        clearInterval(this.timer);
        this.timer = undefined;
    }
    async release(): Promise<void> {
        this.stop();
        this.begins.clear();
        this.checkpoints.clear();
        await this.update(false).catch(() => undefined);
    }
    private async update(retain: boolean): Promise<void> {
        let held = false;
        for (const source of this.client.contexts.keys()) {
            for (const entry of await this.client.store.entries(source)) {
                if (
                    retain &&
                    entry.address.sourceIncarnation !==
                        this.client.contexts.get(source)?.sourceIncarnation
                )
                    continue;
                if (
                    !entry.record.pending.some(
                        (intent) => intent.deliveryLease?.owner === this.owner
                    )
                )
                    continue;
                await this.client.store.mutate(entry.address, (current) => {
                    if (!current)
                        throw new Error('Activity outbox disappeared');
                    return {
                        ...current,
                        pending: current.pending.map((intent) => {
                            if (intent.deliveryLease?.owner !== this.owner)
                                return intent;
                            if (retain) {
                                if (!this.fresh(intent)) return intent;
                                held = true;
                                return {
                                    ...intent,
                                    deliveryLease: this.lease(),
                                };
                            }
                            const released = { ...intent };
                            delete released.deliveryLease;
                            return released;
                        }),
                    };
                });
            }
        }
        if (retain && !held) this.stop();
    }
}

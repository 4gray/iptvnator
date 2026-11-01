import type { ActivityApplyResult } from '@iptvnator/shared/interfaces/activity-sync';
import type { ActivitySyncClient } from './activity-sync-client';
import { commitActivityDelivery } from './activity-delivery-response';

export async function sendPendingActivity(
    this: ActivitySyncClient
): Promise<void> {
    try {
        for (const source of this.contexts.keys()) {
            for (const entry of await this.store.entries(source)) {
                if (
                    entry.address.sourceIncarnation !==
                    this.contexts.get(source)?.sourceIncarnation
                )
                    continue;
                let record = entry.record;
                let rebases = 0;
                while (record.pending.length && !record.conflict) {
                    const candidate = record.pending[0];
                    if (candidate.consentGeneration !== this.options.consent())
                        break;
                    this.options.status('pending');
                    const claim = await this.delivery.claim(
                        entry.address,
                        candidate.operation.operationId
                    );
                    if (!claim.record) break;
                    record = claim.record;
                    if (!claim.allowed) {
                        if (
                            record.pending[0]?.operation.operationId !==
                            candidate.operation.operationId
                        )
                            continue;
                        break;
                    }
                    const next = record.pending[0];
                    if (next.consentGeneration !== this.options.consent())
                        break;
                    const result = (await this.request({
                        operation: 'activity-apply',
                        activity: {
                            address: next.address,
                            operation: next.operation,
                        },
                    })) as ActivityApplyResult;
                    const response = await commitActivityDelivery(
                        this,
                        entry.address,
                        next,
                        result,
                        rebases
                    );
                    record = response.record;
                    if (response.rebased) rebases++;
                }
                if (record.conflict) {
                    for (const intent of record.pending)
                        this.delivery.settled(intent.operation.operationId);
                    this.options.status('conflict');
                }
            }
        }
        this.options.changed();
        if (!(await this.store.pending()).length) this.options.status('ready');
    } catch {
        await this.delivery.release();
        this.options.status('offline');
    }
}

import {
    activityAddressKey,
    type ActivityAddress,
    type ActivityLocalRecord,
    type ActivityLocalStore,
    type ActivityPendingOperation,
} from '@iptvnator/shared/interfaces/activity-sync';

export class MemoryActivityStore implements ActivityLocalStore {
    private rows = new Map<
        string,
        { address: ActivityAddress; record: ActivityLocalRecord }
    >();
    private tail = Promise.resolve();
    async read(address: ActivityAddress) {
        await this.tail;
        return structuredClone(
            this.rows.get(activityAddressKey(address))?.record ?? null
        );
    }
    async entries(sourceId: string) {
        await this.tail;
        return structuredClone(
            [...this.rows.values()].filter(
                (row) => row.address.sourceId === sourceId
            )
        );
    }
    async pending() {
        await this.tail;
        return [...this.rows.values()].reduce<ActivityPendingOperation[]>(
            (all, row) => all.concat(row.record.pending),
            []
        );
    }
    mutate(
        address: ActivityAddress,
        change: (current: ActivityLocalRecord | null) => ActivityLocalRecord
    ): Promise<ActivityLocalRecord> {
        const operation = this.tail.then(() => {
            const key = activityAddressKey(address);
            const next = change(
                structuredClone(this.rows.get(key)?.record ?? null)
            );
            this.rows.set(key, structuredClone({ address, record: next }));
            return structuredClone(next);
        });
        this.tail = operation.then(
            () => undefined,
            () => undefined
        );
        return operation;
    }
}

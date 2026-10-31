import type {
    ActivityAddress,
    ActivityLocalRecord,
    ActivityLocalRequest,
    ActivityLocalStore,
    ActivityPendingOperation,
} from '@iptvnator/shared/interfaces/activity-sync';

/** Compare/read/commit retries keep sibling windows' mutations inside the worker transaction. */
export class ElectronActivityLocalStore implements ActivityLocalStore {
    constructor(
        private readonly instanceId: string,
        private readonly send: (
            request: ActivityLocalRequest
        ) => Promise<unknown>
    ) {}
    async read(address: ActivityAddress): Promise<ActivityLocalRecord | null> {
        return this.send({
            operation: 'read',
            instanceId: this.instanceId,
            address,
        }) as Promise<ActivityLocalRecord | null>;
    }
    async entries(
        sourceId: string
    ): Promise<{ address: ActivityAddress; record: ActivityLocalRecord }[]> {
        return this.send({
            operation: 'list',
            instanceId: this.instanceId,
            sourceId,
        }) as Promise<
            { address: ActivityAddress; record: ActivityLocalRecord }[]
        >;
    }
    async pending(): Promise<ActivityPendingOperation[]> {
        return this.send({
            operation: 'pending',
            instanceId: this.instanceId,
        }) as Promise<ActivityPendingOperation[]>;
    }
    async mutate(
        address: ActivityAddress,
        change: (current: ActivityLocalRecord | null) => ActivityLocalRecord
    ): Promise<ActivityLocalRecord> {
        for (let attempt = 0; attempt < 20; attempt++) {
            const current = await this.read(address);
            const expected = current === null ? null : JSON.stringify(current);
            const value = change(current);
            const result = (await this.send({
                operation: 'commit',
                instanceId: this.instanceId,
                address,
                expected,
                value,
            })) as { value?: ActivityLocalRecord; conflict?: boolean };
            if (!result.conflict && result.value) return result.value;
        }
        throw new Error('Activity storage busy');
    }
}

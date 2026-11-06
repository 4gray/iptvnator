import type {
    FavoriteAddress,
    FavoriteLocalRecord,
    FavoriteLocalRequest,
    FavoriteLocalStore,
    FavoritePending,
} from '@iptvnator/shared/interfaces/favorites-sync';

/** Compare/read/commit retries keep sibling windows' mutations inside the worker transaction. */
export class ElectronFavoriteLocalStore implements FavoriteLocalStore {
    constructor(
        private readonly instanceId: string,
        private readonly send: (
            request: FavoriteLocalRequest
        ) => Promise<unknown>
    ) {}
    async read(address: FavoriteAddress): Promise<FavoriteLocalRecord | null> {
        return this.send({
            operation: 'read',
            instanceId: this.instanceId,
            address,
        }) as Promise<FavoriteLocalRecord | null>;
    }
    async entries(
        sourceId: string
    ): Promise<{ address: FavoriteAddress; record: FavoriteLocalRecord }[]> {
        return this.send({
            operation: 'list',
            instanceId: this.instanceId,
            sourceId,
        }) as Promise<
            { address: FavoriteAddress; record: FavoriteLocalRecord }[]
        >;
    }
    async pending(): Promise<FavoritePending[]> {
        return this.send({
            operation: 'pending',
            instanceId: this.instanceId,
        }) as Promise<FavoritePending[]>;
    }
    async mutate(
        address: FavoriteAddress,
        change: (current: FavoriteLocalRecord | null) => FavoriteLocalRecord
    ): Promise<FavoriteLocalRecord> {
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
            })) as { value?: FavoriteLocalRecord; conflict?: boolean };
            if (!result.conflict && result.value) return result.value;
        }
        throw new Error('Favorite storage busy');
    }
}

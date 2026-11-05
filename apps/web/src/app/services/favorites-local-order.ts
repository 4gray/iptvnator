/** Device-local display order; this never enters the favorites wire protocol. */
export class FavoritesLocalOrder {
    constructor(
        private readonly instanceId: string,
        private readonly storage: Pick<Storage, 'getItem' | 'setItem'>
    ) {}
    private key(sourceId: string) {
        return `iptvnator-server:${this.instanceId}:favorites-order:${sourceId}`;
    }
    read(sourceId: string): string[] {
        const value: unknown = JSON.parse(
            this.storage.getItem(this.key(sourceId)) ?? '[]'
        );
        return Array.isArray(value)
            ? value.filter((key): key is string => typeof key === 'string')
            : [];
    }
    write(sourceId: string, keys: string[]): void {
        this.storage.setItem(this.key(sourceId), JSON.stringify(keys));
    }
}

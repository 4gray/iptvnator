import {
    DEFAULT_PERSONAL_SCOPE,
    type PersonalScope,
} from '@iptvnator/shared/interfaces/profiles';

/** Device-local display order; this never enters the favorites wire protocol. */
export class FavoritesLocalOrder {
    constructor(
        private readonly instanceId: string,
        private readonly storage: Pick<Storage, 'getItem' | 'setItem'>,
        private readonly scope: PersonalScope = DEFAULT_PERSONAL_SCOPE
    ) {}
    /** The Default profile keeps its historic key, so existing orders still read. */
    private key(sourceId: string) {
        const base = `iptvnator-server:${this.instanceId}:favorites-order`;
        return this.scope === DEFAULT_PERSONAL_SCOPE
            ? `${base}:${sourceId}`
            : `${base}:${this.scope}:${sourceId}`;
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

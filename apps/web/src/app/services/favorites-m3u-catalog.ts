import type { Playlist } from '@iptvnator/shared/interfaces';
/** Resolve hash/legacy membership from a local catalog, without fetching provider streams. */
export class FavoritesM3uCatalog {
    private readonly catalogs = new Map<
        string,
        { stamp: string; value: Promise<Playlist> }
    >();
    constructor(
        private readonly read: (sourceId: string) => Promise<Playlist>,
        private readonly incarnation: (sourceId: string) => string | undefined
    ) {}
    stamp(source: Playlist): string {
        return JSON.stringify([
            source.sourceSyncRevision,
            source.updateDate,
            source.count,
            this.incarnation(source._id),
        ]);
    }
    async resolve(source: Playlist): Promise<Playlist> {
        if (
            source.playlist?.items ||
            source.items ||
            source.serverUrl ||
            source.macAddress ||
            source.portalUrl
        )
            return source;
        const stamp = this.stamp(source);
        let cached = this.catalogs.get(source._id);
        if (cached?.stamp !== stamp) {
            const value = this.read(source._id);
            cached = { stamp, value };
            this.catalogs.set(source._id, cached);
            value.catch(() => {
                if (this.catalogs.get(source._id)?.value === value)
                    this.catalogs.delete(source._id);
            });
        }
        const raw = await cached.value;
        return { ...source, playlist: raw.playlist, items: raw.items };
    }
}

import type { Playlist } from '@iptvnator/shared/interfaces';
import { FavoritesM3uCatalog } from './favorites-m3u-catalog';

it('shares a catalog load until its source revision or incarnation changes', async () => {
    let incarnation = 'first';
    const read = jest.fn(
        async () =>
            ({
                playlist: { items: [{ url: 'https://synthetic.test/stream' }] },
            }) as unknown as Playlist
    );
    const catalog = new FavoritesM3uCatalog(read, () => incarnation);
    const source = {
        _id: 'synthetic-source',
        sourceSyncRevision: 'r1',
    } as Playlist;
    const [a, b] = await Promise.all([
        catalog.resolve(source),
        catalog.resolve(source),
    ]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(a.playlist).toBe(b.playlist);
    await catalog.resolve({ ...source, sourceSyncRevision: 'r2' });
    expect(read).toHaveBeenCalledTimes(2);
    incarnation = 'second';
    await catalog.resolve({ ...source, sourceSyncRevision: 'r2' });
    expect(read).toHaveBeenCalledTimes(3);
});

it('retries a failed catalog load and preserves metadata from the caller', async () => {
    const read = jest
        .fn<Promise<Playlist>, [string]>()
        .mockRejectedValueOnce(new Error('Synthetic offline'))
        .mockResolvedValue({
            items: [{ url: 'https://synthetic.test/stream' }],
        } as unknown as Playlist);
    const catalog = new FavoritesM3uCatalog(read, () => 'first');
    const source = {
        _id: 'synthetic-source',
        title: 'Synthetic current title',
    } as Playlist;
    await expect(catalog.resolve(source)).rejects.toThrow('Synthetic offline');
    expect(await catalog.resolve(source)).toMatchObject({
        title: source.title,
        items: [{ url: 'https://synthetic.test/stream' }],
    });
    expect(read).toHaveBeenCalledTimes(2);
});

import { collectionEpgKey } from './collection-epg-key';

it('uses provider identity even when the same channel has different collection UIDs or XMLTV labels', () => {
    const channel = {
        sourceType: 'xtream' as const,
        playlistId: 'one',
        xtreamId: 42,
        name: 'News',
        tvgId: 'old',
    };
    expect(collectionEpgKey(channel)).toBe(
        collectionEpgKey({ ...channel, tvgId: 'new', name: 'Renamed' })
    );
    expect(collectionEpgKey(channel)).not.toBe(
        collectionEpgKey({ ...channel, playlistId: 'two' })
    );
    expect(collectionEpgKey(channel)).not.toBe(
        collectionEpgKey({ ...channel, sourceType: 'stalker', stalkerId: 42 })
    );
});

it('does not collide when provider or playlist IDs contain separators', () => {
    const channel = {
        sourceType: 'stalker' as const,
        playlistId: 'a::b',
        stalkerId: 'c',
        name: 'News',
    };
    expect(collectionEpgKey(channel)).not.toBe(
        collectionEpgKey({ ...channel, playlistId: 'a', stalkerId: 'b::c' })
    );
});

it('keeps XMLTV lookup semantics for M3U and declines missing portal IDs', () => {
    const channel = {
        sourceType: 'm3u' as const,
        playlistId: 'one',
        tvgId: ' tvg ',
        name: 'News',
    };
    expect(collectionEpgKey(channel)).toBe('tvg');
    expect(collectionEpgKey({ ...channel, tvgId: '' })).toBe('News');
    expect(collectionEpgKey({ ...channel, sourceType: 'xtream' })).toBeNull();
    expect(
        collectionEpgKey({ ...channel, sourceType: 'stalker', stalkerId: ' ' })
    ).toBeNull();
});

import { TestBed } from '@angular/core/testing';
import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    FAVORITES_PLAYLIST_BRIDGE,
    mutateFavoritePlaylist,
} from './favorites-events';

it('keeps the default bridge local and preserves a first edit through ordinary persistence', async () => {
    const bridge = TestBed.inject(FAVORITES_PLAYLIST_BRIDGE);
    const source = { _id: 'synthetic-source' } as Playlist;
    const persist = jest.fn(async (playlist: Playlist) => playlist);
    expect(bridge.active()).toBe(false);
    expect(await bridge.project(source)).toBe(source);
    expect(
        await mutateFavoritePlaylist(
            source,
            () => ['synthetic-channel'],
            bridge,
            persist
        )
    ).toMatchObject({ favorites: ['synthetic-channel'] });
    expect(persist).toHaveBeenCalledTimes(1);
    await expect(
        mutateFavoritePlaylist(
            null as unknown as Playlist,
            () => [],
            bridge,
            persist
        )
    ).rejects.toThrow('Favorite source unavailable');
});

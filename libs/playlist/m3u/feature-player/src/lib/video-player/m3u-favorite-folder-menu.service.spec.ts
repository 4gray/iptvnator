import { InjectionToken, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { selectFavorites } from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    FavoriteChannelFoldersService,
    type FavoriteChannelFolder,
} from '@iptvnator/portal/shared/data-access';
import { Store } from '@ngrx/store';
import type { M3uFavoriteFolderMenuService as M3uFavoriteFolderMenuServiceType } from './m3u-favorite-folder-menu.service';
import { sampleChannel } from './video-player.spec-harness';

const favoriteFolderDialogsToken = new InjectionToken('FavoriteFolderDialogs');
// Avoid evaluating the UI entry point and its Video.js dependency in Jest ESM.
jest.unstable_mockModule('@iptvnator/portal/shared/ui', () => ({
    FavoriteFolderDialogs: favoriteFolderDialogsToken,
}));

describe('M3uFavoriteFolderMenuService', () => {
    let M3uFavoriteFolderMenuService: typeof M3uFavoriteFolderMenuServiceType;
    const playlist = { _id: 'synthetic-m3u', filename: 'Synthetic playlist' };
    const activePlaylist = signal<typeof playlist | null>(playlist);
    const activePlaylistId = signal(playlist._id);
    const folders = signal<FavoriteChannelFolder[]>([]);
    const favoriteIds = signal<string[]>([]);
    const load = jest.fn().mockResolvedValue(undefined);
    const move = jest.fn().mockResolvedValue(true);
    const selectSignal = jest.fn().mockReturnValue(favoriteIds);
    const channel = { ...sampleChannel, url: 'https://example.test/live' };

    beforeAll(async () => {
        ({ M3uFavoriteFolderMenuService } =
            await import('./m3u-favorite-folder-menu.service'));
    });

    beforeEach(() => {
        activePlaylist.set(playlist);
        activePlaylistId.set(playlist._id);
        folders.set([{ id: 'synthetic-folder', name: 'Daytime' }]);
        favoriteIds.set([]);
        load.mockClear();
        move.mockClear();
        selectSignal.mockClear();
        TestBed.configureTestingModule({
            providers: [
                M3uFavoriteFolderMenuService,
                {
                    provide: PlaylistContextFacade,
                    useValue: { activePlaylist, activePlaylistId },
                },
                {
                    provide: FavoriteChannelFoldersService,
                    useValue: { folders, load },
                },
                { provide: favoriteFolderDialogsToken, useValue: { move } },
                { provide: Store, useValue: { selectSignal } },
            ],
        });
    });

    it('offers a folder action only for a valid channel in the current playlist when folders exist', () => {
        const menu = TestBed.inject(M3uFavoriteFolderMenuService);

        expect(load).toHaveBeenCalledTimes(1);
        expect(selectSignal).toHaveBeenCalledWith(selectFavorites);
        expect(menu.action(channel)).toBe('add');
        expect(menu.action(null)).toBeNull();
        expect(menu.action({ ...channel, url: ' ' })).toBeNull();

        activePlaylistId.set('other-source');
        menu.open(channel, 'add');
        expect(menu.action(channel)).toBeNull();

        activePlaylist.set(null);
        expect(menu.available()).toBe(false);

        activePlaylist.set(playlist);
        activePlaylistId.set(playlist._id);
        folders.set([]);
        expect(menu.action(channel)).toBeNull();
        expect(move).not.toHaveBeenCalled();
    });

    it('passes the source and channel to the add dialog with a trimmed URL identity', () => {
        const menu = TestBed.inject(M3uFavoriteFolderMenuService);
        const paddedChannel = { ...channel, url: ` ${channel.url} ` };

        menu.open(paddedChannel, 'add');

        expect(move).toHaveBeenCalledWith(
            [
                {
                    uid: 'm3u::synthetic-m3u::https://example.test/live',
                    sourceType: 'm3u',
                    contentType: 'live',
                    playlistId: 'synthetic-m3u',
                    playlistName: 'Synthetic playlist',
                    name: channel.name,
                    logo: channel.tvg.logo,
                    streamUrl: paddedChannel.url,
                    channelId: channel.id,
                    radio: channel.radio,
                    m3uChannel: paddedChannel,
                },
            ],
            { add: true }
        );
    });

    it.each([channel.url, channel.id])(
        'moves an existing favorite recorded as %s and ignores a stale add action',
        (storedId) => {
            const menu = TestBed.inject(M3uFavoriteFolderMenuService);
            favoriteIds.set(['other-channel', storedId]);

            expect(menu.action(channel)).toBe('move');
            menu.open(channel, 'add');
            menu.open(null, 'move');
            expect(move).not.toHaveBeenCalled();

            menu.open(channel, 'move');
            expect(move).toHaveBeenCalledWith(
                [
                    expect.objectContaining({
                        playlistId: 'synthetic-m3u',
                        streamUrl: channel.url,
                    }),
                ],
                { add: false }
            );
        }
    );

    it('keeps the folder action hidden if folder loading fails', async () => {
        folders.set([]);
        load.mockRejectedValueOnce(new Error('Synthetic read failure'));
        const menu = TestBed.inject(M3uFavoriteFolderMenuService);

        await Promise.resolve();

        expect(menu.action(channel)).toBeNull();
    });
});

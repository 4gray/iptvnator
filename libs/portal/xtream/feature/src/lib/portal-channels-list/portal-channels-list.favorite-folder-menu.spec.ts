import { signal } from '@angular/core';
import { PortalChannelsListComponent } from './portal-channels-list.component';

describe('Xtream live channel folder menu', () => {
    const playlist = { id: 'synthetic-xtream', name: 'Synthetic portal' };
    const channel = {
        xtream_id: 17,
        type: 'live' as const,
        title: 'Synthetic live channel',
        stream_icon: 'https://example.test/channel.png',
    };

    function setup() {
        const currentPlaylist = signal<typeof playlist | undefined>(playlist);
        const showFavoriteFolderMenu = signal(true);
        const move = jest.fn().mockResolvedValue(true);
        const open = jest.fn();
        const toggleFavorite = jest.fn().mockResolvedValue(false);
        const notify = jest.fn();
        const component: PortalChannelsListComponent = Object.assign(
            Object.create(PortalChannelsListComponent.prototype),
            {
                xtreamStore: {
                    currentPlaylist,
                    selectedContentType: () => 'live',
                    toggleFavorite,
                },
                contextMenuChannel: signal(null),
                favorites: new Map<string, boolean>(),
                showFavoriteFolderMenu,
                channelContextMenu: () => ({ open }),
                folderDialogs: { move },
                favoriteMarks: { notify },
                cdr: { detectChanges: jest.fn() },
            }
        );
        return {
            component,
            currentPlaylist,
            showFavoriteFolderMenu,
            move,
            open,
            toggleFavorite,
            notify,
        };
    }

    afterEach(() => jest.restoreAllMocks());

    it('opens the menu for a row and hides folder actions for movies, missing folders, and stale sources', async () => {
        const {
            component,
            currentPlaylist,
            showFavoriteFolderMenu,
            move,
            open,
        } = setup();
        const event = new MouseEvent('contextmenu');

        expect(component.favoriteFolderMenuAction()).toBeNull();
        component.onChannelContextMenu({ ...channel, type: 'movie' }, event);
        expect(open).toHaveBeenCalledWith(event);
        expect(component.favoriteFolderMenuAction()).toBeNull();
        await component.openFavoriteFolderMenu('add');

        component.onChannelContextMenu(channel, event);
        expect(component.favoriteFolderMenuAction()).toBe('add');
        showFavoriteFolderMenu.set(false);
        expect(component.favoriteFolderMenuAction()).toBeNull();
        showFavoriteFolderMenu.set(true);
        currentPlaylist.set({ ...playlist, id: 'other-source' });
        expect(component.favoriteFolderMenuAction()).toBeNull();
        await component.openFavoriteFolderMenu('add');

        currentPlaylist.set(undefined);
        expect(component.favoriteFolderMenuAction()).toBeNull();
        await component.openFavoriteFolderMenu('add');
        component.onChannelContextMenu(channel, event);
        expect(component.favoriteFolderMenuAction()).toBeNull();
        expect(move).not.toHaveBeenCalled();
    });

    it.each([true, false])(
        'adds the live channel despite a colliding movie favorite and refreshes only on confirmation (%s)',
        async (confirmed) => {
            const { component, move } = setup();
            const dispatch = jest.spyOn(window, 'dispatchEvent');
            move.mockResolvedValueOnce(confirmed);
            component.favorites.set('movie:17', true);
            component.onChannelContextMenu(
                channel,
                new MouseEvent('contextmenu')
            );

            expect(component.favoriteFolderMenuAction()).toBe('add');
            await component.openFavoriteFolderMenu('add');

            expect(move).toHaveBeenCalledWith(
                [
                    {
                        uid: 'xtream::synthetic-xtream::live:17',
                        sourceType: 'xtream',
                        contentType: 'live',
                        playlistId: 'synthetic-xtream',
                        playlistName: 'Synthetic portal',
                        name: channel.title,
                        xtreamId: 17,
                        logo: channel.stream_icon,
                    },
                ],
                { add: true }
            );
            expect(dispatch.mock.calls.map(([event]) => event.type)).toEqual(
                confirmed ? ['iptvnator-favorites-changed'] : []
            );
        }
    );

    it('moves a live favorite without adding it again', async () => {
        const { component, move } = setup();
        const dispatch = jest.spyOn(window, 'dispatchEvent');
        component.favorites.set('live:17', true);
        component.onChannelContextMenu(
            {
                xtream_id: 17,
                name: 'Synthetic channel without title',
                poster_url: 'https://example.test/poster.png',
            },
            new MouseEvent('contextmenu')
        );

        expect(component.favoriteFolderMenuAction()).toBe('move');
        await component.openFavoriteFolderMenu('add');
        expect(move).not.toHaveBeenCalled();

        await component.openFavoriteFolderMenu('move');
        expect(move).toHaveBeenCalledWith(
            [
                expect.objectContaining({
                    uid: 'xtream::synthetic-xtream::live:17',
                    name: 'Synthetic channel without title',
                    logo: 'https://example.test/poster.png',
                }),
            ],
            { add: false }
        );
        expect(dispatch).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'announces removal to the original source and updates its marker only while current (source changed %s)',
        async (sourceChanged) => {
            const { component, currentPlaylist, toggleFavorite, notify } =
                setup();
            component.favorites.set('live:17', true);
            component.toggleFavorite(new MouseEvent('click'), channel);
            if (sourceChanged) {
                currentPlaylist.set({ ...playlist, id: 'other-source' });
            }
            await Promise.resolve();

            expect(toggleFavorite).toHaveBeenCalledWith(
                17,
                playlist.id,
                'live'
            );
            expect(component.favorites.has('live:17')).toBe(sourceChanged);
            expect(notify).toHaveBeenCalledWith({
                playlistId: playlist.id,
                key: 'live:17',
                isFavorite: false,
            });
        }
    );
});

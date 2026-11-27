import { signal } from '@angular/core';
import { StalkerLiveStreamLayoutComponent } from './stalker-live-stream-layout.component';

describe('Stalker live channel folder menu', () => {
    const playlist = { _id: 'synthetic-stalker', filename: 'Synthetic portal' };
    const channel = {
        id: 'legacy-17',
        stream_id: 'provider-17',
        cmd: 'ffrt4://example.test/itv/17',
        name: 'Synthetic live channel',
        o_name: 'Synthetic original title',
        logo: 'https://example.test/channel.png',
    };

    function setup() {
        const currentPlaylist = signal<typeof playlist | undefined>(playlist);
        const showFavoriteFolderMenu = signal(true);
        const isRadioMode = signal(false);
        const move = jest.fn().mockResolvedValue(true);
        const open = jest.fn();
        const addToFavorites = jest.fn();
        const removeFromFavorites = jest.fn();
        const component: StalkerLiveStreamLayoutComponent = Object.assign(
            Object.create(StalkerLiveStreamLayoutComponent.prototype),
            {
                stalkerStore: {
                    currentPlaylist,
                    addToFavorites,
                    removeFromFavorites,
                },
                favorites: new Map<string, boolean>(),
                contextMenuChannel: signal(null),
                channelContextMenu: () => ({ open }),
                showFavoriteFolderMenu,
                isRadioMode,
                folderDialogs: { move },
            }
        );
        return {
            component,
            currentPlaylist,
            showFavoriteFolderMenu,
            isRadioMode,
            move,
            open,
            addToFavorites,
            removeFromFavorites,
        };
    }

    afterEach(() => jest.restoreAllMocks());

    it('opens the menu for the channel and invalidates its action when folders or the source disappear', async () => {
        const {
            component,
            currentPlaylist,
            showFavoriteFolderMenu,
            move,
            open,
        } = setup();
        const event = new MouseEvent('contextmenu');

        expect(component.favoriteFolderMenuAction()).toBeNull();
        component.onChannelContextMenu(channel, event);
        expect(open).toHaveBeenCalledWith(event);
        expect(component.favoriteFolderMenuAction()).toBe('add');

        showFavoriteFolderMenu.set(false);
        expect(component.favoriteFolderMenuAction()).toBeNull();
        showFavoriteFolderMenu.set(true);
        currentPlaylist.set({ ...playlist, _id: 'other-source' });
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
        'adds a radio channel using its provider identity and refreshes only on confirmation (%s)',
        async (confirmed) => {
            const { component, isRadioMode, move } = setup();
            const dispatch = jest.spyOn(window, 'dispatchEvent');
            const radio = {
                ...channel,
                cmd: 'ifm https://example.test/radio',
                o_name: '',
            };
            isRadioMode.set(true);
            move.mockResolvedValueOnce(confirmed);
            component.onChannelContextMenu(
                radio,
                new MouseEvent('contextmenu')
            );

            await component.openFavoriteFolderMenu('add');

            expect(move).toHaveBeenCalledWith(
                [
                    {
                        uid: 'stalker::synthetic-stalker::provider-17',
                        sourceType: 'stalker',
                        contentType: 'live',
                        playlistId: 'synthetic-stalker',
                        playlistName: 'Synthetic portal',
                        name: radio.name,
                        logo: radio.logo,
                        stalkerId: 'provider-17',
                        stalkerCmd: radio.cmd,
                        categoryId: 'radio',
                        radio: 'true',
                        stalkerItem: {
                            ...radio,
                            id: 'provider-17',
                            favoriteContentType: 'radio',
                        },
                    },
                ],
                { add: true }
            );
            expect(dispatch.mock.calls.map(([event]) => event.type)).toEqual(
                confirmed ? ['iptvnator-favorites-changed'] : []
            );
        }
    );

    it.each([channel.id, channel.stream_id])(
        'moves an existing favorite under the stored identity %s',
        async (favoriteId) => {
            const { component, move } = setup();
            const dispatch = jest.spyOn(window, 'dispatchEvent');
            component.favorites.set(favoriteId, true);
            component.onChannelContextMenu(
                channel,
                new MouseEvent('contextmenu')
            );

            expect(component.favoriteFolderMenuAction()).toBe('move');
            await component.openFavoriteFolderMenu('add');
            expect(move).not.toHaveBeenCalled();

            await component.openFavoriteFolderMenu('move');
            expect(move).toHaveBeenCalledWith(
                [
                    expect.objectContaining({
                        uid: `stalker::synthetic-stalker::${favoriteId}`,
                        stalkerId: favoriteId,
                        name: channel.o_name,
                        categoryId: 'itv',
                        stalkerItem: expect.objectContaining({
                            id: favoriteId,
                            favoriteContentType: 'itv',
                        }),
                    }),
                ],
                { add: false }
            );
            expect(dispatch).not.toHaveBeenCalled();
        }
    );

    it('ignores a row with no usable provider identity', async () => {
        const { component, move } = setup();
        component.onChannelContextMenu(
            { ...channel, id: ' ', stream_id: ' ' },
            new MouseEvent('contextmenu')
        );

        await component.openFavoriteFolderMenu('add');

        expect(move).not.toHaveBeenCalled();
    });

    it.each([true, false])(
        'does not apply a favorite acknowledgement to a replacement source (initial favorite %s)',
        (wasFavorite) => {
            const {
                component,
                currentPlaylist,
                addToFavorites,
                removeFromFavorites,
            } = setup();
            if (wasFavorite) component.favorites.set(channel.stream_id, true);

            component.toggleFavorite(channel);
            const write = wasFavorite ? removeFromFavorites : addToFavorites;
            expect(write).toHaveBeenCalledTimes(1);
            currentPlaylist.set({ ...playlist, _id: 'other-source' });
            write.mock.calls[0][1]();

            expect(component.favorites.has(channel.stream_id)).toBe(
                wasFavorite
            );
        }
    );
});

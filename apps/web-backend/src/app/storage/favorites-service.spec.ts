import { withTempStorage } from './server-storage.spec-helpers';
import { ServerFavoriteService } from './favorites-service';
import type { FavoriteAddress } from '@iptvnator/shared/interfaces/favorites-sync';

describe('favorite authorization metadata reads', () => {
    it.each([false, true])(
        'avoids full payload reads for verified M3U sources (text=%s)',
        (text) =>
            withTempStorage((storage) => {
                const document = {
                    _id: 'synthetic-source',
                    title: 'Synthetic source',
                    ...(text
                        ? {
                              sourceRawM3u:
                                  '#EXTM3U\n#EXTINF:-1,Synthetic channel\nhttps://fixture.invalid/stream',
                          }
                        : { url: 'https://fixture.invalid/source.m3u' }),
                    playlist: {
                        items: [
                            {
                                url: 'https://fixture.invalid/stream',
                                name: 'Synthetic channel',
                            },
                        ],
                    },
                };
                storage.playlists.upsert(document, { keepPayload: false });
                const service = new ServerFavoriteService(storage);
                const initial = service.context(document._id);
                const fullRead = jest
                    .spyOn(storage.playlists, 'get')
                    .mockImplementation(() => {
                        throw new Error('Unexpected full payload read');
                    });
                const address: FavoriteAddress = {
                    instanceId: storage.database.instanceId,
                    scope: 'shared',
                    ...initial,
                    content: {
                        provider: 'm3u',
                        version: 1,
                        urlHash: 'a'.repeat(64),
                    },
                };
                for (let i = 0; i < 10; i++)
                    expect(service.context(document._id)).toEqual(initial);
                expect(
                    service.states.apply(address, {
                        operationId: 'synthetic-add',
                        deviceId: 'synthetic-device',
                        expectedRevision: 0,
                        member: true,
                    }).status
                ).toBe('applied');
                expect(service.states.read(address).member).toBe(true);
                expect(
                    service.states.list(
                        storage.database.instanceId,
                        service.context(document._id)
                    ).entries
                ).toHaveLength(1);
                expect(fullRead).not.toHaveBeenCalled();
                fullRead.mockRestore();
                storage.playlists.upsert(
                    {
                        ...document,
                        ...(text
                            ? {
                                  sourceRawM3u:
                                      '#EXTM3U\n#EXTINF:-1,Synthetic replacement\nhttps://fixture.invalid/replacement',
                              }
                            : {
                                  url: 'https://fixture.invalid/replacement.m3u',
                              }),
                    },
                    { keepPayload: false }
                );
                expect(() => service.states.read(address)).toThrow(
                    'Source identity changed'
                );
                storage.playlists.delete(document._id);
                expect(() => service.context(document._id)).toThrow(
                    'Source no longer exists'
                );
            })
    );
});

import { withTempStorage } from './server-storage.spec-helpers';

describe('ServerUserStateRepository', () => {
    it('returns every namespace, empty by default', () =>
        withTempStorage(({ userState }) => {
            expect(userState.all()).toEqual({
                'xtream-favorites': {},
                'xtream-recent-items': {},
                'xtream-collection-items': {},
                'xtream-playback-positions': {},
            });
        }));

    it('stores, overwrites and deletes one entry', () =>
        withTempStorage(({ userState }) => {
            userState.put('xtream-favorites', 'p1', ['live:1']);
            userState.put('xtream-favorites', 'p1', ['live:2']);
            expect(userState.all()['xtream-favorites']).toEqual({
                p1: ['live:2'],
            });

            userState.delete('xtream-favorites', 'p1');
            expect(userState.all()['xtream-favorites']).toEqual({});
        }));

    it('deletes a playlist across namespaces', () =>
        withTempStorage(({ userState }) => {
            userState.put('xtream-favorites', 'p1', ['live:1']);
            userState.put('xtream-recent-items', 'p1', []);
            userState.put('xtream-favorites', 'p2', ['live:3']);

            userState.deleteForPlaylist('p1');

            const all = userState.all();
            expect(all['xtream-favorites']).toEqual({ p2: ['live:3'] });
            expect(all['xtream-recent-items']).toEqual({});
        }));
});

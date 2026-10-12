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

    it('round-trips a playlist id that names an Object.prototype key', () =>
        withTempStorage(({ userState }) => {
            userState.put('xtream-favorites', '__proto__', ['live:1']);
            userState.put('xtream-favorites', 'constructor', ['live:2']);

            const favorites = userState.all()['xtream-favorites'];

            expect(Object.getOwnPropertyNames(favorites).sort()).toEqual([
                '__proto__',
                'constructor',
            ]);
            expect(JSON.parse(JSON.stringify(favorites))).toEqual(
                JSON.parse('{"__proto__":["live:1"],"constructor":["live:2"]}')
            );
        }));
});

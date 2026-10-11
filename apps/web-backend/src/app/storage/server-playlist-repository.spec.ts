import { sql } from 'drizzle-orm';
import { PlaylistPayloadMissingError } from './server-playlist-repository';
import { m3uDocument, withTempStorage } from './server-storage.spec-helpers';

describe('ServerPlaylistRepository', () => {
    it('stores and reads a whole playlist document', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(m3uDocument('p1'), { keepPayload: false });

            expect(playlists.get('p1')).toMatchObject({
                _id: 'p1',
                title: 'Family',
                playlist: m3uDocument('p1').playlist,
            });
            expect(playlists.count()).toBe(1);
            expect(playlists.get('missing')).toBeNull();
        }));

    it('lists metadata without the payload', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(m3uDocument('p1'), { keepPayload: false });

            const [meta] = playlists.listMetas();

            expect(meta).toMatchObject({ _id: 'p1', title: 'Family' });
            expect(meta['playlist']).toBeUndefined();
            expect(playlists.listAll()[0]['playlist']).toEqual(
                m3uDocument('p1').playlist
            );
        }));

    it('keeps the stored payload when asked to', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(m3uDocument('p1'), { keepPayload: false });
            const meta: Record<string, unknown> = { ...m3uDocument('p1') };
            delete meta['playlist'];

            playlists.upsert(
                {
                    ...meta,
                    title: 'Renamed',
                    favorites: ['https://example.test/a'],
                },
                { keepPayload: true }
            );

            expect(playlists.get('p1')).toMatchObject({
                title: 'Renamed',
                favorites: ['https://example.test/a'],
                playlist: m3uDocument('p1').playlist,
            });
        }));

    it('keeps payload-only metadata in metadata reads and round-trips', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(
                {
                    ...m3uDocument('p1'),
                    filename: 'family.m3u',
                    hiddenGroupTitles: ['Adult'],
                    stalkerSerialNumber: 'SN-1',
                },
                { keepPayload: false }
            );

            const [meta] = playlists.listMetas();
            expect(meta).toMatchObject({
                filename: 'family.m3u',
                hiddenGroupTitles: ['Adult'],
                stalkerSerialNumber: 'SN-1',
            });
            expect(meta['playlist']).toBeUndefined();

            playlists.upsert(
                { ...meta, title: 'Renamed' },
                { keepPayload: true }
            );

            expect(playlists.get('p1')).toMatchObject({
                title: 'Renamed',
                filename: 'family.m3u',
                hiddenGroupTitles: ['Adult'],
                stalkerSerialNumber: 'SN-1',
                playlist: m3uDocument('p1').playlist,
            });
        }));

    it('serves complete metadata without reading the payload', () =>
        withTempStorage(({ database, playlists }) => {
            playlists.upsert(
                {
                    ...m3uDocument('p1'),
                    filename: 'family.m3u',
                    hiddenGroupTitles: ['Adult'],
                },
                { keepPayload: false }
            );
            // A metadata read must not depend on the payload blob at all.
            database.db.run(
                sql`UPDATE playlists SET payload = 'not json' WHERE id = 'p1'`
            );

            expect(playlists.listMetas()[0]).toMatchObject({
                _id: 'p1',
                title: 'Family',
                filename: 'family.m3u',
                hiddenGroupTitles: ['Adult'],
            });
        }));

    it('keeps a carried-over panel clock in metadata reads', () =>
        withTempStorage(({ playlists }) => {
            const panel = {
                _id: 'x1',
                title: 'Panel',
                serverUrl: 'http://panel.test',
                username: 'user',
                password: 'secret',
                importDate: '2026-10-01T00:00:00.000Z',
            };
            playlists.upsert(
                { ...panel, serverTimezone: 'Europe/Berlin' },
                { keepPayload: false }
            );

            // An older snapshot without the clock, same panel account.
            playlists.upsert(
                { ...panel, title: 'Renamed' },
                { keepPayload: false }
            );
            const kept = { title: 'Renamed', serverTimezone: 'Europe/Berlin' };
            expect(playlists.get('x1')).toMatchObject(kept);
            expect(playlists.listMetas()[0]).toMatchObject(kept);

            // A different account drops the clock in both reads.
            playlists.upsert(
                { ...panel, password: 'changed' },
                { keepPayload: false }
            );
            expect(playlists.get('x1')?.['serverTimezone']).toBeUndefined();
            expect(playlists.listMetas()[0]['serverTimezone']).toBeUndefined();
        }));

    it('drops the metadata copy with its playlist', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(m3uDocument('p1'), { keepPayload: false });
            playlists.upsert(m3uDocument('p2'), { keepPayload: false });

            playlists.delete('p1');
            expect(playlists.listMetas().map((p) => p['_id'])).toEqual(['p2']);
            playlists.deleteAll();
            expect(playlists.listMetas()).toEqual([]);
        }));

    it('clears optional columns that a replacement leaves empty', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(
                {
                    ...m3uDocument('p1'),
                    userAgent: 'UA/1',
                    referrer: 'https://ref.test',
                    origin: 'https://origin.test',
                },
                { keepPayload: false }
            );

            playlists.upsert(
                {
                    ...m3uDocument('p1'),
                    userAgent: '',
                    referrer: '',
                },
                { keepPayload: false }
            );

            const stored = playlists.get('p1');
            expect(stored?.['userAgent']).toBeUndefined();
            expect(stored?.['referrer']).toBeUndefined();
            expect(stored?.['origin']).toBeUndefined();
            expect(playlists.listMetas()[0]['userAgent']).toBeUndefined();
        }));

    it('tells whether a playlist exists', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(m3uDocument('p1'), { keepPayload: false });

            expect(playlists.exists('p1')).toBe(true);
            expect(playlists.exists('nope')).toBe(false);
        }));

    it('refuses keepPayload for an unknown playlist', () =>
        withTempStorage(({ playlists }) => {
            expect(() =>
                playlists.upsert(
                    { _id: 'nope', title: 'x' },
                    { keepPayload: true }
                )
            ).toThrow(PlaylistPayloadMissingError);
        }));

    it('deletes one or all playlists', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(m3uDocument('p1'), { keepPayload: false });
            playlists.upsert(m3uDocument('p2'), { keepPayload: false });

            playlists.delete('p1');
            expect(playlists.listMetas().map((p) => p['_id'])).toEqual(['p2']);

            playlists.deleteAll();
            expect(playlists.count()).toBe(0);
        }));

    it('reads and writes app state', () =>
        withTempStorage(({ playlists }) => {
            expect(playlists.getAppState('flag')).toBeNull();
            playlists.setAppState('flag', '1');
            expect(playlists.getAppState('flag')).toBe('1');
        }));
});

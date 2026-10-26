import { type Playlist } from '@iptvnator/shared/interfaces';
import { applySourceDefinition } from '@iptvnator/shared/interfaces/source-definition';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';
import { migrateLegacyPlaylistActivity } from './legacy-playlist-activity';
import { requestSourceServer } from './source-api';
jest.mock('./source-api', () => ({ requestSourceServer: jest.fn() }));

describe('existing browser playlist activity upgrade', () => {
    const connection = { apiUrl: 'https://nas.test/api', instanceId: 'nas' };
    const instance = {
        service: 'iptvnator',
        apiVersion: 1,
        storage: 'server',
        instanceId: 'nas',
        capabilities: ['sources-v1'],
    };
    const originalFetch = globalThis.fetch;
    let rows: Map<string, Playlist>;
    let state: Map<string, string>;
    let local: PlaylistDocumentStore;
    const old = {
        ...applySourceDefinition({
            id: 'p',
            title: 'Old',
            kind: 'm3u-text',
            rawM3u: '#EXTM3U',
        }),
        favorites: ['https://media.test/live'],
        recentlyViewed: [
            {
                source: 'm3u',
                id: 'one',
                title: 'Watched',
                url: 'https://media.test/live',
                category_id: 'live',
                added_at: '2026-10-26',
            },
        ],
    };
    beforeEach(() => {
        rows = new Map();
        state = new Map();
        localStorage.clear();
        local = {
            dbGetAppState: async (key) => state.get(key) ?? null,
            dbSetAppState: async (key, value) => {
                state.set(key, value);
                return { success: true };
            },
            dbGetAppPlaylist: async (id) => rows.get(id) ?? null,
            dbUpsertAppPlaylist: async (row) => {
                rows.set(row._id, row);
                return { success: true };
            },
        } as PlaylistDocumentStore;
        globalThis.fetch = jest
            .fn()
            .mockResolvedValue({ ok: true, json: async () => [old] });
        (requestSourceServer as jest.Mock).mockResolvedValue({
            status: 200,
            body: instance,
        });
    });
    afterEach(() => {
        localStorage.clear();
        globalThis.fetch = originalFetch;
    });
    it('never reads shared activity for a newly connected browser', async () => {
        await migrateLegacyPlaylistActivity(local, connection, new Set(['p']));
        expect(fetch).not.toHaveBeenCalled();
        expect(rows.size).toBe(0);
    });
    it('adopts old activity once and never copies sessions or overwrites current activity', async () => {
        localStorage.setItem('iptvnator-server:cache-owner', 'nas');
        await migrateLegacyPlaylistActivity(local, connection, new Set(['p']));
        expect(rows.get('p')).toMatchObject({
            favorites: old.favorites,
            recentlyViewed: old.recentlyViewed,
        });
        rows.get('p')!.favorites = [];
        await migrateLegacyPlaylistActivity(local, connection, new Set(['p']));
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(rows.get('p')!.favorites).toEqual([]);
    });
    it('recognizes a remembered M3U-only client and refuses another server instance', async () => {
        localStorage.setItem(
            'iptvnator-server:instance',
            JSON.stringify({ instance })
        );
        (requestSourceServer as jest.Mock).mockResolvedValueOnce({
            status: 200,
            body: { ...instance, instanceId: 'other' },
        });
        await expect(
            migrateLegacyPlaylistActivity(local, connection, new Set(['p']))
        ).rejects.toThrow('INSTANCE_CHANGED');
        expect(rows.size).toBe(0);
        expect(state.size).toBe(0);
        await migrateLegacyPlaylistActivity(local, connection, new Set(['p']));
        expect(rows.has('p')).toBe(true);
    });
});

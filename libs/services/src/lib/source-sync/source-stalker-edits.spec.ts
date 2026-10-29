import type { Playlist, SourceDefinition } from '@iptvnator/shared/interfaces';
import { applySourceDefinition } from '@iptvnator/shared/interfaces/source-definition';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';
import type { DataService } from '../data.service';
import { materializeSource } from './source-materializer';
import { SyncedPlaylistStore } from './synced-playlist-store';

const original: SourceDefinition = {
    id: 'portal',
    title: 'Shared portal',
    kind: 'stalker',
    portalUrl: 'https://portal.test/c',
    macAddress: '00:1A:79:00:00:01',
    username: 'user',
    password: 'old',
    isFullStalkerPortal: true,
};
// Confirmed session fingerprints use the existing persisted wire format.
const fingerprint = (source: SourceDefinition) =>
    JSON.stringify([
        source.portalUrl,
        '["00:1A:79:00:00:01","","","","",""]',
        source.username,
        source.password,
    ]);

function setup(before: SourceDefinition, accepted: SourceDefinition) {
    let row: Playlist = {
        ...applySourceDefinition(before),
        sourceSyncBase: before,
        sourceSyncRevision: '"1"',
        stalkerToken: 'old-token',
        stalkerSessionIdentity: fingerprint(before),
        stalkerWatchdogTimeout: 120,
        favorites: ['device-only'],
    };
    const local = {
        dbGetAppPlaylist: async () => structuredClone(row),
        dbUpsertAppPlaylist: async (next: Playlist) => {
            row = structuredClone(next);
            return { success: true };
        },
    } as unknown as PlaylistDocumentStore;
    const request = jest.fn(async () => ({
        status: 200,
        body: accepted,
        etag: '"2"',
    }));
    const store = new SyncedPlaylistStore(local, request, (source, current) =>
        materializeSource(source, current, {} as DataService)
    );
    return { store, request, read: () => row };
}

describe('accepted shared Stalker edits', () => {
    it.each([{ password: 'new' }, { portalUrl: 'https://replacement.test/c' }])(
        'retains the session negotiated for $portalUrl $password',
        async (patch) => {
            const accepted = { ...original, ...patch };
            const { store, request, read } = setup(original, accepted);
            const incoming = applySourceDefinition(
                accepted,
                (await store.dbGetAppPlaylist(original.id))!
            );
            const session = {
                stalkerToken: 'confirmed-token',
                stalkerSessionIdentity: fingerprint(accepted),
                stalkerWatchdogTimeout: 45,
                stalkerTimeslot: 3,
                stalkerAccountInfo: { status: 1 },
            };
            await store.dbUpsertAppPlaylist({ ...incoming, ...session });
            expect(read()).toMatchObject({
                ...session,
                sourceSyncBase: accepted,
                sourceSyncRevision: '"2"',
                favorites: ['device-only'],
            });
            expect(request).toHaveBeenCalledWith(
                expect.objectContaining({ source: accepted })
            );
            expect(JSON.stringify(request.mock.calls)).not.toContain(
                'confirmed-token'
            );

            // A later remote edit must still invalidate this device's accepted session.
            await store.project(
                { ...accepted, password: 'remote-edit' },
                '"3"'
            );
            expect(read()).not.toHaveProperty('stalkerToken');
            expect(read()).not.toHaveProperty('stalkerSessionIdentity');
        }
    );

    it.each([{ password: 'new' }, { isFullStalkerPortal: false }])(
        'drops the obsolete session when the caller has no accepted session',
        async (patch) => {
            const accepted = { ...original, ...patch };
            const { store, read } = setup(original, accepted);
            await store.dbUpsertAppPlaylist(
                applySourceDefinition(
                    accepted,
                    (await store.dbGetAppPlaylist(original.id))!
                )
            );
            expect(read()).not.toHaveProperty('stalkerToken');
            expect(read()).not.toHaveProperty('stalkerSessionIdentity');
            expect(read()).not.toHaveProperty('stalkerWatchdogTimeout');
            expect(read().favorites).toEqual(['device-only']);
        }
    );
});

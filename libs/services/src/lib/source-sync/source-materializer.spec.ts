import {
    applySourceDefinition,
    PlaylistUpdateState,
    type SourceDefinition,
} from '@iptvnator/shared/interfaces';
import type { DataService } from '../data.service';
import { materializeSource } from './source-materializer';

describe('source projection into a local runtime', () => {
    const stalker: SourceDefinition = {
        id: 'portal',
        title: 'Portal',
        kind: 'stalker',
        portalUrl: 'https://portal.test/c',
        macAddress: '00:1A:79:00:00:01',
        username: 'user',
        password: 'old',
    };

    it('drops a negotiated Stalker session after a connection change while preserving local favorites', async () => {
        const current = {
            ...applySourceDefinition(stalker),
            stalkerToken: 'old-session',
            stalkerSessionIdentity: 'old-identity',
            stalkerAccountInfo: { status: 1 },
            stalkerWatchdogTimeout: 42,
            stalkerTimeslot: 3,
            serverTimezone: 'Europe/Berlin',
            favorites: ['private'],
        };
        const projected = await materializeSource(
            { ...stalker, password: 'new' },
            current,
            {} as DataService
        );
        expect(projected.password).toBe('new');
        expect(projected.favorites).toEqual(['private']);
        for (const field of [
            'stalkerToken',
            'stalkerSessionIdentity',
            'stalkerAccountInfo',
            'stalkerWatchdogTimeout',
            'stalkerTimeslot',
            'serverTimezone',
        ])
            expect(projected).not.toHaveProperty(field);
    });

    it('keeps a local Stalker session when only the shared title changes', async () => {
        const current = {
            ...applySourceDefinition(stalker),
            stalkerToken: 'local-session',
        };
        const projected = await materializeSource(
            { ...stalker, title: 'Renamed' },
            current,
            {} as DataService
        );
        expect(projected.stalkerToken).toBe('local-session');
    });

    it('downloads a shared URL through the runtime transport and removes the originating file path', async () => {
        const source: SourceDefinition = {
            id: 'url',
            title: 'Remote URL',
            kind: 'm3u-url',
            url: 'https://provider.test/list.m3u',
            userAgent: 'Source agent',
        };
        const fetchPlaylistDefinition = jest.fn(async () => ({
            playlist: {
                header: { raw: '#EXTM3U' },
                items: [{ name: 'Shared', url: 'https://media.test/live' }],
            },
            count: 1,
        }));
        const current = {
            ...applySourceDefinition(source),
            filePath: '/another-device/local.m3u',
            favorites: ['private'],
        };
        const projected = await materializeSource(source, current, {
            fetchPlaylistDefinition,
        } as unknown as DataService);
        expect(fetchPlaylistDefinition).toHaveBeenCalledWith(
            source.url,
            source.userAgent
        );
        expect(projected.count).toBe(1);
        expect(projected.playlist?.items[0].name).toBe('Shared');
        expect(projected.favorites).toEqual(['private']);
        expect(projected.filePath).toBeUndefined();
    });

    it('does not present channels from the old URL when a replacement URL cannot be fetched', async () => {
        const source: SourceDefinition = {
            id: 'url',
            title: 'New provider',
            kind: 'm3u-url',
            url: 'https://new.test/list.m3u',
        };
        const current = {
            ...applySourceDefinition({
                ...source,
                url: 'https://old.test/list.m3u',
            }),
            playlist: { header: { raw: '#EXTM3U' }, items: [] },
            count: 5,
        };
        const data = {
            fetchPlaylistDefinition: jest
                .fn()
                .mockRejectedValue(new Error('unreachable')),
        } as unknown as DataService;
        const projected = await materializeSource(source, current, data);
        expect(projected.count).toBe(0);
        expect(projected.updateState).toBe(PlaylistUpdateState.NOT_UPDATED);
        expect(projected.url).toBe(source.url);
    });
});

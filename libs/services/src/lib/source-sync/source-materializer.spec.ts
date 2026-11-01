import {
    PlaylistUpdateState,
    type SourceDefinition,
} from '@iptvnator/shared/interfaces';
import { applySourceDefinition } from '@iptvnator/shared/interfaces/source-definition';
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
        expect(projected.sourceSyncPending).toBe(true);
    });

    it.each(['m3u-url', 'm3u-text'] as const)(
        'keeps detected EPG and local choices when materializing %s',
        async (kind) => {
            const source: SourceDefinition = {
                id: 'epg',
                title: 'EPG',
                kind,
                ...(kind === 'm3u-url'
                    ? { url: 'https://provider.test/list.m3u' }
                    : {
                          rawM3u: '#EXTM3U x-tvg-url="https://provider.test/epg.xml"\n#EXTINF:-1,Channel\nhttps://media.test/live',
                      }),
            };
            const detected = ['https://provider.test/epg.xml'];
            const current = {
                ...applySourceDefinition(source),
                manualEpgUrls: ['https://manual.test/epg.xml'],
                disabledEpgUrls: detected,
            };
            const fetchPlaylistDefinition = jest.fn().mockResolvedValue({
                playlist: { header: { raw: '#EXTM3U' }, items: [] },
                count: 0,
                detectedEpgUrls: detected,
                epgUrls: detected,
            });
            const projected = await materializeSource(source, current, {
                fetchPlaylistDefinition,
            } as unknown as DataService);
            expect(projected.detectedEpgUrls).toEqual(detected);
            expect(projected.epgUrls).toEqual(current.manualEpgUrls);
            expect(projected.disabledEpgUrls).toEqual(detected);
            const fresh = await materializeSource(source, undefined, {
                fetchPlaylistDefinition,
            } as unknown as DataService);
            expect(fresh.epgUrls).toEqual(detected);

            const optedOut = await materializeSource(
                source,
                {
                    ...current,
                    autoImportEpg: false,
                    disabledEpgUrls: [],
                },
                { fetchPlaylistDefinition } as unknown as DataService
            );
            expect(optedOut.autoImportEpg).toBe(false);
            expect(optedOut.detectedEpgUrls).toEqual(detected);
            expect(optedOut.epgUrls).toEqual(current.manualEpgUrls);
        }
    );
});

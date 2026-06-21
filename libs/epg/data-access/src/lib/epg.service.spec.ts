import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { SettingsStore } from '@iptvnator/services';
import { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';
import { EpgService } from './epg.service';

describe('EpgService', () => {
    let service: EpgService;
    let epgBridge: Partial<EpgRuntimeBridgeService>;
    let snackBar: { open: jest.Mock };
    let settingsStore: { getSettings: jest.Mock; getTrustOptions: jest.Mock };

    beforeEach(() => {
        epgBridge = {
            fetchEpg: jest.fn().mockResolvedValue({ success: true }),
            getChannelPrograms: jest.fn().mockResolvedValue([]),
            getCurrentProgramsBatch: jest.fn().mockResolvedValue({}),
            supportsCurrentProgramBatch: false,
            supportsImport: false,
            supportsProgramLookup: false,
        };
        snackBar = {
            open: jest.fn(),
        };
        settingsStore = {
            getSettings: jest.fn(() => ({
                epgUrl: [],
                trustedPrivateNetworkEpgUrls: ['http://192.168.1.20/guide.xml'],
                trustedInsecureTlsHosts: ['playlist.local'],
            })),
            getTrustOptions: jest.fn(() => ({
                trustedPrivateNetworkEpgUrls: ['http://192.168.1.20/guide.xml'],
                trustedInsecureTlsHosts: ['playlist.local'],
            })),
        };

        TestBed.configureTestingModule({
            providers: [
                EpgService,
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: epgBridge,
                },
                {
                    provide: MatSnackBar,
                    useValue: snackBar,
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: settingsStore,
                },
            ],
        });

        service = TestBed.inject(EpgService);
    });

    it('does not fetch EPG when bridge import support is disabled', () => {
        service.fetchEpg(['https://example.com/epg.xml']);

        expect(epgBridge.fetchEpg).not.toHaveBeenCalled();
    });

    it('fetches EPG through the EPG runtime bridge when import support is enabled', () => {
        epgBridge.supportsImport = true;

        service.fetchEpg([
            'https://example.com/epg.xml',
            '',
            'https://example.com/other.xml',
            ' https://example.com/epg.xml ',
        ]);

        expect(epgBridge.fetchEpg).toHaveBeenCalledWith(
            ['https://example.com/epg.xml', 'https://example.com/other.xml'],
            {
                trustedPrivateNetworkEpgUrls: ['http://192.168.1.20/guide.xml'],
                trustedInsecureTlsHosts: ['playlist.local'],
            }
        );
    });

    it('does not show a fetch error when the bridge returns no result', async () => {
        epgBridge.supportsImport = true;
        (epgBridge.fetchEpg as jest.Mock).mockResolvedValue(null);

        service.fetchEpg(['https://example.com/epg.xml']);
        await Promise.resolve();

        expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('returns an empty batch result when the desktop bridge is unavailable', async () => {
        const result = await firstValueFrom(
            service.getCurrentProgramsForChannels(['channel-1'])
        );

        expect(result).toEqual(new Map());
        expect(epgBridge.getCurrentProgramsBatch).not.toHaveBeenCalled();
    });

    it('returns null for current program lookup when the desktop bridge is unavailable', async () => {
        await expect(
            firstValueFrom(service.getCurrentProgramForChannel('channel-1'))
        ).resolves.toBeNull();
        expect(epgBridge.getChannelPrograms).not.toHaveBeenCalled();
    });

    it('uses the EPG runtime bridge for current program lookup when supported', async () => {
        epgBridge.supportsProgramLookup = true;
        epgBridge.getChannelPrograms = jest.fn().mockResolvedValue([
            {
                channel: 'channel-1',
                start: '2026-05-23T10:00:00.000Z',
                stop: '2026-05-23T11:00:00.000Z',
                title: 'Morning News',
            },
        ]);
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-23T10:30:00.000Z'));

        await expect(
            firstValueFrom(service.getCurrentProgramForChannel('channel-1'))
        ).resolves.toMatchObject({ title: 'Morning News' });

        expect(epgBridge.getChannelPrograms).toHaveBeenCalledWith('channel-1');
        jest.useRealTimers();
    });

    it('caches current program lookups separately by EPG source URL scope', async () => {
        settingsStore.getSettings.mockReturnValue({
            epgUrl: ['https://global.example.com/guide.xml'],
            trustedPrivateNetworkEpgUrls: [],
            trustedInsecureTlsHosts: [],
        });
        epgBridge.supportsProgramLookup = true;
        epgBridge.getChannelPrograms = jest
            .fn()
            .mockResolvedValueOnce([
                {
                    channel: 'guide-news',
                    start: '2026-05-23T10:00:00.000Z',
                    stop: '2026-05-23T11:00:00.000Z',
                    title: 'Playlist Guide Bulletin',
                },
            ])
            .mockResolvedValueOnce([
                {
                    channel: 'guide-news',
                    start: '2026-05-23T10:00:00.000Z',
                    stop: '2026-05-23T11:00:00.000Z',
                    title: 'Global News Bulletin',
                },
            ])
            .mockResolvedValue([]);
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-23T10:30:00.000Z'));

        try {
            const playlistResult = await firstValueFrom(
                service.getCurrentProgramForChannel('guide-news', {
                    sourceUrls: ['https://playlist.example.com/guide.xml'],
                })
            );
            const globalResult = await firstValueFrom(
                service.getCurrentProgramForChannel('guide-news')
            );
            const cachedPlaylistResult = await firstValueFrom(
                service.getCurrentProgramForChannel('guide-news', {
                    sourceUrls: [' https://playlist.example.com/guide.xml '],
                })
            );
            const cachedGlobalResult = await firstValueFrom(
                service.getCurrentProgramForChannel('guide-news')
            );

            expect(playlistResult?.title).toBe('Playlist Guide Bulletin');
            expect(globalResult?.title).toBe('Global News Bulletin');
            expect(cachedPlaylistResult?.title).toBe('Playlist Guide Bulletin');
            expect(cachedGlobalResult?.title).toBe('Global News Bulletin');
            expect(epgBridge.getChannelPrograms).toHaveBeenCalledTimes(2);
            expect(epgBridge.getChannelPrograms).toHaveBeenNthCalledWith(
                1,
                'guide-news',
                { sourceUrls: ['https://playlist.example.com/guide.xml'] }
            );
            expect(epgBridge.getChannelPrograms).toHaveBeenNthCalledWith(
                2,
                'guide-news',
                { sourceUrls: ['https://global.example.com/guide.xml'] }
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it('deduplicates concurrent scoped current program lookups for the same source scope', async () => {
        epgBridge.supportsProgramLookup = true;
        let resolvePrograms:
            | ((
                  programs: {
                      channel: string;
                      start: string;
                      stop: string;
                      title: string;
                  }[]
              ) => void)
            | undefined;
        epgBridge.getChannelPrograms = jest.fn(
            () =>
                new Promise((resolve) => {
                    resolvePrograms = resolve;
                })
        );
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-23T10:30:00.000Z'));

        try {
            const firstLookup = firstValueFrom(
                service.getCurrentProgramForChannel('guide-news', {
                    sourceUrls: ['https://playlist.example.com/guide.xml'],
                })
            );
            const secondLookup = firstValueFrom(
                service.getCurrentProgramForChannel('guide-news', {
                    sourceUrls: [' https://playlist.example.com/guide.xml '],
                })
            );

            expect(epgBridge.getChannelPrograms).toHaveBeenCalledTimes(1);
            resolvePrograms?.([
                {
                    channel: 'guide-news',
                    start: '2026-05-23T10:00:00.000Z',
                    stop: '2026-05-23T11:00:00.000Z',
                    title: 'Playlist Guide Bulletin',
                },
            ]);

            await expect(
                Promise.all([firstLookup, secondLookup])
            ).resolves.toEqual([
                expect.objectContaining({
                    title: 'Playlist Guide Bulletin',
                }),
                expect.objectContaining({
                    title: 'Playlist Guide Bulletin',
                }),
            ]);
        } finally {
            jest.useRealTimers();
        }
    });

    it('queries playlist-scoped current programs first and falls back to global EPG for missing channels', async () => {
        settingsStore.getSettings.mockReturnValue({
            epgUrl: [
                'https://global.example.com/guide.xml',
                ' https://global.example.com/guide.xml ',
            ],
            trustedPrivateNetworkEpgUrls: [],
            trustedInsecureTlsHosts: [],
        });
        epgBridge.supportsProgramLookup = true;
        epgBridge.supportsCurrentProgramBatch = true;
        epgBridge.getCurrentProgramsBatch = jest
            .fn()
            .mockResolvedValueOnce({
                'guide-news': {
                    channel: 'guide-news',
                    start: '2026-05-23T10:00:00.000Z',
                    stop: '2026-05-23T11:00:00.000Z',
                    title: 'Playlist Guide Bulletin',
                },
                'guide-sports': null,
            })
            .mockResolvedValueOnce({
                'guide-sports': {
                    channel: 'guide-sports',
                    start: '2026-05-23T10:00:00.000Z',
                    stop: '2026-05-23T11:00:00.000Z',
                    title: 'Global Sports Bulletin',
                },
            });

        const result = await firstValueFrom(
            service.getCurrentProgramsForChannels(
                ['guide-news', 'guide-sports'],
                { sourceUrls: ['https://playlist.example.com/guide.xml'] }
            )
        );

        expect(result.get('guide-news')?.title).toBe('Playlist Guide Bulletin');
        expect(result.get('guide-sports')?.title).toBe(
            'Global Sports Bulletin'
        );
        expect(epgBridge.getCurrentProgramsBatch).toHaveBeenNthCalledWith(
            1,
            ['guide-news', 'guide-sports'],
            { sourceUrls: ['https://playlist.example.com/guide.xml'] }
        );
        expect(epgBridge.getCurrentProgramsBatch).toHaveBeenNthCalledWith(
            2,
            ['guide-sports'],
            { sourceUrls: ['https://global.example.com/guide.xml'] }
        );
    });

    it('does not fall back to the unscoped EPG pool when no global EPG URLs are configured', async () => {
        epgBridge.supportsProgramLookup = true;
        epgBridge.supportsCurrentProgramBatch = true;
        epgBridge.getCurrentProgramsBatch = jest.fn().mockResolvedValue({
            'guide-sports': null,
        });

        const result = await firstValueFrom(
            service.getCurrentProgramsForChannels(['guide-sports'], {
                sourceUrls: ['https://playlist.example.com/guide.xml'],
            })
        );

        expect(result.get('guide-sports')).toBeNull();
        expect(epgBridge.getCurrentProgramsBatch).toHaveBeenCalledTimes(1);
        expect(epgBridge.getCurrentProgramsBatch).toHaveBeenCalledWith(
            ['guide-sports'],
            { sourceUrls: ['https://playlist.example.com/guide.xml'] }
        );
    });

    it('returns null scoped current programs instead of re-entering global lookup when scoped batch lookup fails', async () => {
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        try {
            settingsStore.getSettings.mockReturnValue({
                epgUrl: ['https://global.example.com/guide.xml'],
                trustedPrivateNetworkEpgUrls: [],
                trustedInsecureTlsHosts: [],
            });
            epgBridge.supportsProgramLookup = true;
            epgBridge.supportsCurrentProgramBatch = true;
            epgBridge.getCurrentProgramsBatch = jest
                .fn()
                .mockRejectedValueOnce(new Error('ipc down'))
                .mockResolvedValueOnce({
                    'guide-news': {
                        channel: 'guide-news',
                        start: '2026-05-23T10:00:00.000Z',
                        stop: '2026-05-23T11:00:00.000Z',
                        title: 'Global News Bulletin',
                    },
                });

            const result = await firstValueFrom(
                service.getCurrentProgramsForChannels(['guide-news'], {
                    sourceUrls: ['https://playlist.example.com/guide.xml'],
                })
            );

            expect(result.get('guide-news')).toBeNull();
            expect(epgBridge.getCurrentProgramsBatch).toHaveBeenCalledTimes(1);
            expect(epgBridge.getCurrentProgramsBatch).toHaveBeenCalledWith(
                ['guide-news'],
                { sourceUrls: ['https://playlist.example.com/guide.xml'] }
            );
        } finally {
            consoleError.mockRestore();
        }
    });
});

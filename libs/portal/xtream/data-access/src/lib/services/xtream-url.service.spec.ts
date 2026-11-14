import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DatabaseService, SettingsStore } from '@iptvnator/services';
import {
    StreamFormat,
    XtreamSerieEpisode,
    XtreamVodDetails,
} from '@iptvnator/shared/interfaces';
import { XtreamCredentials } from './xtream-api.service';
import { XtreamUrlService } from './xtream-url.service';

describe('XtreamUrlService', () => {
    let service: XtreamUrlService;
    let databaseService: {
        getAppState: jest.Mock<Promise<string | null>, [string]>;
        setAppState: jest.Mock<Promise<void>, [string, string]>;
    };
    let streamFormat: WritableSignal<StreamFormat>;

    const credentials: XtreamCredentials = {
        serverUrl: 'http://demo.example',
        username: 'demo',
        password: 'secret',
    };
    const originalElectron = window.electron;

    beforeEach(() => {
        streamFormat = signal(StreamFormat.TsStreamFormat);
        databaseService = {
            getAppState: jest.fn().mockResolvedValue(null),
            setAppState: jest.fn().mockResolvedValue(undefined),
        };

        TestBed.configureTestingModule({
            providers: [
                XtreamUrlService,
                { provide: DatabaseService, useValue: databaseService },
                {
                    provide: SettingsStore,
                    useValue: {
                        streamFormat,
                    },
                },
            ],
        });

        service = TestBed.inject(XtreamUrlService);
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('normalizes portal base URLs and trims credentials for live streams', () => {
        const url = service.constructLiveUrl(
            {
                serverUrl: ' https://demo.example/base/ ',
                username: ' demo ',
                password: ' secret ',
            },
            101
        );

        expect(url).toBe('https://demo.example/base/live/demo/secret/101.ts');
    });

    it('uses the first allowed provider output format when the selected live format is not allowed', () => {
        const url = service.constructLiveUrl(
            {
                ...credentials,
                allowedOutputFormats: ['m3u8'],
            },
            101
        );

        expect(url).toBe('http://demo.example/live/demo/secret/101.m3u8');
    });

    it('auto-selects HLS for live streams when the provider allows it', () => {
        streamFormat.set(StreamFormat.AutoStreamFormat);

        const url = service.constructLiveUrl(
            {
                ...credentials,
                allowedOutputFormats: ['ts', 'm3u8'],
            },
            101
        );

        expect(url).toBe('http://demo.example/live/demo/secret/101.m3u8');
    });

    it('auto-selects MPEG-TS for live streams when it is the only provider format', () => {
        streamFormat.set(StreamFormat.AutoStreamFormat);

        const url = service.constructLiveUrl(
            {
                ...credentials,
                allowedOutputFormats: ['ts'],
            },
            101
        );

        expect(url).toBe('http://demo.example/live/demo/secret/101.ts');
    });

    it('uses HLS as the auto live-stream fallback when provider formats are unknown', () => {
        streamFormat.set(StreamFormat.AutoStreamFormat);

        const url = service.constructLiveUrl(credentials, 101);

        expect(url).toBe('http://demo.example/live/demo/secret/101.m3u8');
    });

    it('keeps the manual live-stream format override when provider formats are unknown', () => {
        streamFormat.set(StreamFormat.TsStreamFormat);

        const url = service.constructLiveUrl(credentials, 101);

        expect(url).toBe('http://demo.example/live/demo/secret/101.ts');
    });

    it('builds an Auto TS alternative with encoded credentials and the provider subpath', () => {
        streamFormat.set(StreamFormat.AutoStreamFormat);
        expect(
            service.constructAutoLiveTsUrl(
                {
                    serverUrl:
                        'https://demo.example/panel/player_api.php?token=unused',
                    username: 'a/b',
                    password: 'x?y#z',
                    allowedOutputFormats: [' M3U8 ', ' TS '],
                },
                101
            )
        ).toBe('https://demo.example/panel/live/a%2Fb/x%3Fy%23z/101.ts');
    });

    it.each([undefined, [], ['m3u8'], ['rtmp'], ['ts']])(
        'does not guess an HLS-to-TS alternative for %j',
        (allowedOutputFormats) => {
            streamFormat.set(StreamFormat.AutoStreamFormat);
            expect(
                service.constructAutoLiveTsUrl(
                    { ...credentials, allowedOutputFormats },
                    101
                )
            ).toBeUndefined();
        }
    );

    it.each([StreamFormat.TsStreamFormat, StreamFormat.M3u8StreamFormat])(
        'respects manual %s even with both formats advertised',
        (format) => {
            streamFormat.set(format);
            expect(
                service.constructAutoLiveTsUrl(
                    { ...credentials, allowedOutputFormats: ['m3u8', 'ts'] },
                    101
                )
            ).toBeUndefined();
        }
    );

    it('constructs a VOD URL from catalog fields when metadata is empty', () => {
        const vodItem = {
            info: [],
            stream_id: 101,
            container_extension: 'mp4',
        } as XtreamVodDetails & {
            stream_id: number;
            container_extension: string;
        };

        expect(service.constructVodUrl(credentials, vodItem)).toBe(
            'http://demo.example/movie/demo/secret/101.mp4'
        );
    });

    it('uses the provider direct source exactly, without guessing an extension', () => {
        expect(
            service.constructVodUrl(credentials, {
                movie_data: {
                    stream_id: 15616981,
                    container_extension: null,
                    direct_source: 'https://media.example/film?token=demo',
                },
            } as unknown as XtreamVodDetails)
        ).toBe('https://media.example/film?token=demo');
    });

    it('returns empty stream URLs instead of throwing for invalid stored server URLs', () => {
        const invalidCredentials: XtreamCredentials = {
            ...credentials,
            serverUrl: 'https://demo:secret@demo.example',
        };
        const vodItem: XtreamVodDetails = {
            movie_data: {
                added: '',
                category_id: '',
                container_extension: 'mp4',
                custom_sid: null,
                direct_source: '',
                name: 'Movie',
                stream_id: 101,
            },
        };
        const episode: XtreamSerieEpisode = {
            added: '',
            container_extension: 'mp4',
            custom_sid: '',
            direct_source: '',
            episode_num: 1,
            id: '202',
            info: [],
            season: 1,
            title: 'Episode',
        };

        expect(service.constructLiveUrl(invalidCredentials, 101)).toBe('');
        expect(service.constructVodUrl(invalidCredentials, vodItem)).toBe('');
        expect(service.constructEpisodeUrl(invalidCredentials, episode)).toBe(
            ''
        );
    });

    it('detects the legacy catchup scheme once and then uses the cached result', async () => {
        const tsOnlyCredentials: XtreamCredentials = {
            ...credentials,
            allowedOutputFormats: ['ts'],
        };
        const probeStreamUrl = jest
            .fn()
            .mockResolvedValueOnce({ status: 404 })
            .mockResolvedValueOnce({ status: 206 });
        window.electron = {
            probeStreamUrl,
        } as unknown as typeof window.electron;

        const firstUrl = await service.resolveCatchupUrl(
            'playlist-1',
            tsOnlyCredentials,
            101,
            1775296800,
            1775300400
        );
        const secondUrl = await service.resolveCatchupUrl(
            'playlist-1',
            tsOnlyCredentials,
            101,
            1775296800,
            1775300400
        );

        expect(firstUrl).toContain('/streaming/timeshift.php?');
        expect(firstUrl).toContain('extension=ts');
        expect(secondUrl).toBe(firstUrl);
        expect(probeStreamUrl).toHaveBeenCalledTimes(2);
        expect(databaseService.setAppState).toHaveBeenCalledWith(
            'xtream-catchup-variant:v5:playlist-1:formats:ts',
            'legacy:ts'
        );
    });

    it('redetects catchup variants when provider output formats become known', async () => {
        const probeStreamUrl = jest.fn(async (url: string) => ({
            status:
                url.includes('/streaming/timeshift.php?') &&
                url.includes('extension=ts')
                    ? 206
                    : url.includes('/streaming/timeshift.php?') &&
                        url.includes('extension=m3u8')
                      ? 200
                      : 0,
        }));
        window.electron = {
            probeStreamUrl,
        } as unknown as typeof window.electron;

        const initialUrl = await service.resolveCatchupUrl(
            'playlist-format-refresh',
            credentials,
            101,
            1775296800,
            1775300400
        );
        const refreshedUrl = await service.resolveCatchupUrl(
            'playlist-format-refresh',
            {
                ...credentials,
                allowedOutputFormats: ['m3u8'],
            },
            101,
            1775296800,
            1775300400
        );

        expect(initialUrl).toContain('extension=ts');
        expect(refreshedUrl).toContain('extension=m3u8');
        expect(probeStreamUrl).toHaveBeenCalledTimes(4);
        expect(databaseService.setAppState).toHaveBeenCalledWith(
            'xtream-catchup-variant:v5:playlist-format-refresh:formats:unknown',
            'legacy:ts'
        );
        expect(databaseService.setAppState).toHaveBeenCalledWith(
            'xtream-catchup-variant:v5:playlist-format-refresh:formats:m3u8',
            'legacy:m3u8'
        );
    });

    it('prefers playable legacy MPEG-TS catchup before HLS for video.js compatible playlists', async () => {
        const probeStreamUrl = jest.fn(async (url: string) => ({
            status:
                url.includes('/streaming/timeshift.php?') &&
                url.includes('extension=ts')
                    ? 206
                    : 0,
        }));
        window.electron = {
            probeStreamUrl,
        } as unknown as typeof window.electron;

        const catchupUrl = await service.resolveCatchupUrl(
            'playlist-hls',
            {
                ...credentials,
                allowedOutputFormats: ['m3u8', 'ts'],
            },
            45,
            1782532800,
            1782534600,
            'UTC'
        );

        expect(catchupUrl).toContain('/streaming/timeshift.php?');
        expect(catchupUrl).toContain('stream=45');
        expect(catchupUrl).toContain('start=2026-06-27%3A04-00');
        expect(catchupUrl).toContain('duration=30');
        expect(catchupUrl).toContain('extension=ts');
        expect(probeStreamUrl).toHaveBeenCalledWith(
            expect.stringContaining('/timeshift/'),
            'GET',
            { userAgent: null, referer: null, origin: null }
        );
        expect(databaseService.setAppState).toHaveBeenCalledWith(
            'xtream-catchup-variant:v5:playlist-hls:formats:m3u8,ts',
            'legacy:ts'
        );
    });

    it('falls back to legacy HLS catchup when MPEG-TS probes fail', async () => {
        const probeStreamUrl = jest.fn(async (url: string) => ({
            status:
                url.includes('/streaming/timeshift.php?') &&
                url.includes('extension=m3u8')
                    ? 200
                    : 0,
        }));
        window.electron = {
            probeStreamUrl,
        } as unknown as typeof window.electron;

        const catchupUrl = await service.resolveCatchupUrl(
            'playlist-hls-only',
            {
                ...credentials,
                allowedOutputFormats: ['m3u8', 'ts'],
            },
            45,
            1782532800,
            1782534600,
            'UTC'
        );

        expect(catchupUrl).toContain('/streaming/timeshift.php?');
        expect(catchupUrl).toContain('extension=m3u8');
        expect(databaseService.setAppState).toHaveBeenCalledWith(
            'xtream-catchup-variant:v5:playlist-hls-only:formats:m3u8,ts',
            'legacy:m3u8'
        );
    });

    it('does not persist the fallback and holds it only for the same programme', async () => {
        // A network failure or a programme without archive answers every
        // variant the same way; it must not pin the playlist to REST TS.
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
        const probeStreamUrl = jest.fn(async () => ({ status: 404 }));
        window.electron = {
            probeStreamUrl,
        } as unknown as typeof window.electron;
        const resolve = (start = 1775296800) =>
            service.resolveCatchupUrl(
                'playlist-unproven',
                { ...credentials, allowedOutputFormats: ['ts'] },
                101,
                start,
                start + 3600
            );

        const firstUrl = await resolve();
        const probesForOneLookup = probeStreamUrl.mock.calls.length;
        // Within the hold the same programme skips probing a hanging panel,
        now.mockReturnValue(1_000_000 + 59_000);
        await resolve();
        expect(probeStreamUrl).toHaveBeenCalledTimes(probesForOneLookup);
        // but another programme of the playlist is still probed.
        await resolve(1775296800 - 7200);
        expect(probeStreamUrl).toHaveBeenCalledTimes(probesForOneLookup * 2);
        // After the hold the first programme is probed again.
        now.mockReturnValue(1_000_000 + 61_000);
        await resolve();

        expect(firstUrl).toContain('/timeshift/');
        expect(firstUrl).toMatch(/\.ts$/);
        expect(databaseService.setAppState).not.toHaveBeenCalled();
        expect(probesForOneLookup).toBeGreaterThan(0);
        expect(probeStreamUrl).toHaveBeenCalledTimes(probesForOneLookup * 3);
        now.mockRestore();
    });

    it('prunes expired fallback holds and keeps their number bounded', async () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(2_000_000);
        window.electron = {
            probeStreamUrl: jest.fn(async () => ({ status: 404 })),
        } as unknown as typeof window.electron;
        const holds = () =>
            (
                service as unknown as {
                    catchupFallbackUntil: Map<string, number>;
                }
            ).catchupFallbackUntil;
        const resolveAt = (start: number) =>
            service.resolveCatchupUrl(
                'playlist-holds',
                { ...credentials, allowedOutputFormats: ['ts'] },
                101,
                start,
                start + 3600
            );

        for (let index = 0; index < 70; index++) {
            await resolveAt(1775296800 + index * 3600);
        }
        expect(holds().size).toBe(64);

        // Once they expire, the next hold sweeps them away.
        now.mockReturnValue(2_000_000 + 61_000);
        await resolveAt(1775296800 - 3600);
        expect(holds().size).toBe(1);
        now.mockRestore();
    });

    it('ignores a variant stored under the previous key version', async () => {
        // v4 could hold a REST TS fallback stored after header-less probes.
        databaseService.getAppState.mockImplementation(async (key: string) =>
            key.startsWith('xtream-catchup-variant:v4:') ? 'rest:ts' : null
        );
        const probeStreamUrl = jest.fn(async (url: string) => ({
            status: url.includes('/streaming/timeshift.php?') ? 206 : 403,
        }));
        window.electron = {
            probeStreamUrl,
        } as unknown as typeof window.electron;

        const catchupUrl = await service.resolveCatchupUrl(
            'playlist-v4',
            { ...credentials, allowedOutputFormats: ['ts'] },
            101,
            1775296800,
            1775300400
        );

        expect(catchupUrl).toContain('/streaming/timeshift.php?');
        expect(databaseService.setAppState).toHaveBeenCalledWith(
            'xtream-catchup-variant:v5:playlist-v4:formats:ts',
            'legacy:ts'
        );
    });

    it('falls back to REST MPEG-TS without a probe bridge and remembers nothing', async () => {
        window.electron = {} as unknown as typeof window.electron;

        const catchupUrl = await service.resolveCatchupUrl(
            'playlist-pwa',
            credentials,
            101,
            1775296800,
            1775300400
        );

        expect(catchupUrl).toContain('/timeshift/');
        expect(databaseService.setAppState).not.toHaveBeenCalled();
    });

    it("probes catchup URLs with the playlist's User-Agent, Referer and Origin", async () => {
        const probeStreamUrl = jest.fn(async () => ({ status: 206 }));
        window.electron = {
            probeStreamUrl,
        } as unknown as typeof window.electron;

        await service.resolveCatchupUrl(
            'playlist-headers',
            {
                ...credentials,
                allowedOutputFormats: ['ts'],
                userAgent: ' SyntheticPlayer/1.0 ',
                referrer: 'http://referrer.example.test/',
                origin: 'http://origin.example.test',
            },
            101,
            1775296800,
            1775300400
        );

        expect(probeStreamUrl).toHaveBeenCalledWith(
            expect.stringContaining('timeshift'),
            'GET',
            {
                userAgent: 'SyntheticPlayer/1.0',
                referer: 'http://referrer.example.test/',
                origin: 'http://origin.example.test',
            }
        );
    });

    describe('formatCatchupStartTime (via constructCatchupUrl)', () => {
        // 2025-03-01 02:00:00 UTC = 2025-02-28 21:00:00 America/New_York
        const timestamp = 1740794400;

        it('formats time in the server timezone when provided', () => {
            const url = service.constructCatchupUrl(
                credentials,
                101,
                timestamp,
                timestamp + 3600,
                'rest',
                'America/New_York'
            );
            expect(url).toContain('2025-02-28:21-00');
        });

        it('falls back to client local time when no timezone is given', () => {
            const url = service.constructCatchupUrl(
                credentials,
                101,
                timestamp,
                timestamp + 3600,
                'rest'
            );
            const date = new Date(timestamp * 1000);
            const pad = (n: number) => String(n).padStart(2, '0');
            const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}:${pad(date.getHours())}-${pad(date.getMinutes())}`;
            expect(url).toContain(expected);
        });

        it('falls back to client local time when an invalid timezone string is given', () => {
            const url = service.constructCatchupUrl(
                credentials,
                101,
                timestamp,
                timestamp + 3600,
                'rest',
                'UTC+5'
            );
            const date = new Date(timestamp * 1000);
            const pad = (n: number) => String(n).padStart(2, '0');
            const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}:${pad(date.getHours())}-${pad(date.getMinutes())}`;
            expect(url).toContain(expected);
        });

        it('formats in the clock-derived fixed offset persisted for a panel with an unusable timezone name', () => {
            // 02:00 UTC at UTC+03:00 is 05:00 the same day; at UTC-03:30 it
            // is 22:30 the previous day.
            expect(
                service.constructCatchupUrl(
                    credentials,
                    101,
                    timestamp,
                    timestamp + 3600,
                    'rest',
                    'UTC+03:00'
                )
            ).toContain('/60/2025-03-01:05-00/101.ts');
            expect(
                service.constructCatchupUrl(
                    credentials,
                    101,
                    timestamp,
                    timestamp + 3600,
                    'legacy',
                    'UTC-03:30'
                )
            ).toContain('start=2025-02-28%3A22-30');
        });

        it('renders server midnight as 00, never 24', () => {
            // 2025-03-01 05:00:00 UTC = 2025-03-01 00:00 America/New_York
            const midnightInNewYork = 1740805200;
            const url = service.constructCatchupUrl(
                credentials,
                101,
                midnightInNewYork,
                midnightInNewYork + 1800,
                'rest',
                'America/New_York'
            );
            expect(url).toContain('/30/2025-03-01:00-00/101.ts');
        });
    });
});

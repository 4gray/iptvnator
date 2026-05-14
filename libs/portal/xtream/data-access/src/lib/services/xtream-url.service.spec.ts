import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DatabaseService, SettingsStore } from 'services';
import { XtreamCredentials } from './xtream-api.service';
import { XtreamUrlService } from './xtream-url.service';

describe('XtreamUrlService', () => {
    let service: XtreamUrlService;
    let databaseService: {
        getAppState: jest.Mock<Promise<string | null>, [string]>;
        setAppState: jest.Mock<Promise<void>, [string, string]>;
    };
    let redirectIndirectStreamsToDirectSource: ReturnType<typeof signal>;

    const credentials: XtreamCredentials = {
        serverUrl: 'http://demo.example',
        username: 'demo',
        password: 'secret',
    };
    const originalElectron = window.electron;

    beforeEach(() => {
        databaseService = {
            getAppState: jest.fn().mockResolvedValue(null),
            setAppState: jest.fn().mockResolvedValue(undefined),
        };
        redirectIndirectStreamsToDirectSource = signal(false);

        TestBed.configureTestingModule({
            providers: [
                XtreamUrlService,
                { provide: DatabaseService, useValue: databaseService },
                {
                    provide: SettingsStore,
                    useValue: {
                        streamFormat: signal('ts'),
                        redirectIndirectStreamsToDirectSource,
                    },
                },
            ],
        });

        service = TestBed.inject(XtreamUrlService);
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('keeps generated Xtream URLs by default even when direct_source is present', () => {
        const url = service.constructVodUrl(credentials, {
            movie_data: {
                stream_id: 10,
                name: 'Movie',
                added: '',
                category_id: '1',
                container_extension: 'mp4',
                custom_sid: null,
                direct_source: 'https://cdn.example/movie.mp4',
            },
        });

        expect(url).toBe('http://demo.example/movie/demo/secret/10.mp4');
    });

    it('uses valid direct_source URLs for live, VOD, and series when enabled', () => {
        redirectIndirectStreamsToDirectSource.set(true);

        expect(
            service.constructLiveUrl(credentials, 11, undefined, {
                xtream_id: 11,
                direct_source: 'https://cdn.example/live.m3u8',
            })
        ).toBe('https://cdn.example/live.m3u8');
        expect(
            service.constructVodUrl(credentials, {
                movie_data: {
                    stream_id: 12,
                    name: 'Movie',
                    added: '',
                    category_id: '1',
                    container_extension: 'mkv',
                    custom_sid: null,
                    direct_source: 'https://cdn.example/movie.mkv',
                },
            })
        ).toBe('https://cdn.example/movie.mkv');
        expect(
            service.constructEpisodeUrl(credentials, {
                id: '13',
                episode_num: 1,
                title: 'Episode',
                container_extension: 'mp4',
                info: [],
                custom_sid: '',
                added: '',
                season: 1,
                direct_source: 'https://cdn.example/episode.mp4',
            })
        ).toBe('https://cdn.example/episode.mp4');
    });

    it('falls back to generated URLs when direct_source is not http or https', () => {
        redirectIndirectStreamsToDirectSource.set(true);

        const url = service.constructVodUrl(credentials, {
            movie_data: {
                stream_id: 10,
                name: 'Movie',
                added: '',
                category_id: '1',
                container_extension: 'mp4',
                custom_sid: null,
                direct_source: 'javascript:alert(1)',
            },
        });

        expect(url).toBe('http://demo.example/movie/demo/secret/10.mp4');
    });

    it('detects the legacy catchup scheme once and then uses the cached result', async () => {
        const xtreamProbeUrl = jest
            .fn()
            .mockResolvedValueOnce({ status: 404 })
            .mockResolvedValueOnce({ status: 302 });
        window.electron = {
            xtreamProbeUrl,
        } as typeof window.electron;

        const firstUrl = await service.resolveCatchupUrl(
            'playlist-1',
            credentials,
            101,
            1775296800,
            1775300400
        );
        const secondUrl = await service.resolveCatchupUrl(
            'playlist-1',
            credentials,
            101,
            1775296800,
            1775300400
        );

        expect(firstUrl).toContain('/streaming/timeshift.php?');
        expect(secondUrl).toBe(firstUrl);
        expect(xtreamProbeUrl).toHaveBeenCalledTimes(2);
        expect(databaseService.setAppState).toHaveBeenCalledWith(
            'xtream-catchup-scheme:playlist-1',
            'legacy'
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
    });
});

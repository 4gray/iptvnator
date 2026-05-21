import type { EpgProgram, PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    buildLiveEpgLookupKeys,
    buildPlaybackPositionReloadKey,
    buildDashboardSourceActions,
    calcEpgProgress,
    formatEpgTimeRange,
    formatRemainingLabel,
    getLiveEpgProgramForCard,
    liveRailTitleKeyForSource,
    playbackProgressPercent,
    resolveDashboardHeroArtwork,
} from './workspace-dashboard-rails.component';
import type { DashboardRailCard } from './dashboard-rail.component';

describe('buildDashboardSourceActions', () => {
    const basePlaylist = {
        _id: 'playlist-1',
        title: 'Playlist',
        importDate: '2026-04-24T08:00:00.000Z',
        autoRefresh: false,
    } as PlaylistMeta;

    const actionIds = (playlist: PlaylistMeta, canRefresh: boolean) =>
        buildDashboardSourceActions(playlist, canRefresh).map(
            (action) => action.id
        );

    it('exposes refresh, info, and remove for refreshable M3U sources', () => {
        const playlist = {
            ...basePlaylist,
            url: 'https://example.com/playlist.m3u',
        } as PlaylistMeta;

        expect(actionIds(playlist, true)).toEqual([
            'refresh',
            'playlist-info',
            'remove',
        ]);
    });

    it('exposes refresh, info, and remove for file-backed M3U sources', () => {
        const playlist = {
            ...basePlaylist,
            filePath: '/tmp/local-playlist.m3u',
        } as PlaylistMeta;

        expect(actionIds(playlist, true)).toEqual([
            'refresh',
            'playlist-info',
            'remove',
        ]);
    });

    it('exposes refresh, info, account, and remove for refreshable Xtream sources', () => {
        const playlist = {
            ...basePlaylist,
            serverUrl: 'https://provider.example.test',
            username: 'demo',
            password: 'secret',
        } as PlaylistMeta;

        expect(actionIds(playlist, true)).toEqual([
            'refresh',
            'playlist-info',
            'account-info',
            'remove',
        ]);
    });

    it('exposes info and remove for Stalker sources', () => {
        const playlist = {
            ...basePlaylist,
            macAddress: '00:1A:79:00:00:01',
            portalUrl: 'https://stalker.example.test',
        } as PlaylistMeta;

        expect(actionIds(playlist, false)).toEqual(['playlist-info', 'remove']);
    });
});

describe('resolveDashboardHeroArtwork', () => {
    const item = {
        title: 'Broken Hero',
        posterUrl: 'https://images.example.test/poster.jpg',
        backdropUrl: 'https://images.example.test/backdrop.jpg',
    };

    it('uses the explicit backdrop when both hero images are available', () => {
        expect(resolveDashboardHeroArtwork(item, {})).toMatchObject({
            backdropUrl: item.backdropUrl,
            backdropSource: 'backdrop',
            hasBackdrop: true,
            posterUrl: item.posterUrl,
        });
    });

    it('falls back from a failed backdrop to the poster cover', () => {
        expect(
            resolveDashboardHeroArtwork(item, {
                [item.backdropUrl]: true,
            })
        ).toMatchObject({
            backdropUrl: item.posterUrl,
            backdropSource: 'poster',
            hasBackdrop: false,
            posterUrl: item.posterUrl,
        });
    });

    it('uses generated fallback artwork when backdrop and poster both fail', () => {
        const artwork = resolveDashboardHeroArtwork(item, {
            [item.backdropUrl]: true,
            [item.posterUrl]: true,
        });

        expect(artwork).toMatchObject({
            backdropSource: 'fallback',
            hasBackdrop: false,
            posterUrl: undefined,
            backdropUrl: undefined,
        });
        expect(artwork.fallbackBackdropBackground).toContain('linear-gradient');
        expect(artwork.fallbackPosterBackground).toContain('linear-gradient');
    });
});

describe('EPG enrichment helpers', () => {
    const baseProgram = (overrides: Partial<EpgProgram> = {}): EpgProgram =>
        ({
            title: 'Tagesschau',
            desc: null,
            start: '2026-05-19T12:00:00.000Z',
            stop: '2026-05-19T12:30:00.000Z',
            startTimestamp: Date.UTC(2026, 4, 19, 12, 0, 0),
            stopTimestamp: Date.UTC(2026, 4, 19, 12, 30, 0),
            ...overrides,
        }) as EpgProgram;

    describe('formatEpgTimeRange', () => {
        it('formats a start–stop window using the locale-independent HH:MM range', () => {
            const range = formatEpgTimeRange(baseProgram());
            // Format is HH:MM – HH:MM (en dash), in the test runner's local
            // timezone — assert structure, not exact hours.
            expect(range).toMatch(/^\d{2}:\d{2} – \d{2}:\d{2}$/);
        });

        it('returns null when either timestamp is missing or unparseable', () => {
            expect(
                formatEpgTimeRange(
                    baseProgram({
                        start: 'not-a-date',
                        startTimestamp: null,
                    })
                )
            ).toBeNull();

            expect(
                formatEpgTimeRange(
                    baseProgram({
                        stop: '',
                        stopTimestamp: null,
                    })
                )
            ).toBeNull();
        });
    });

    describe('calcEpgProgress', () => {
        const program = baseProgram();
        const start = program.startTimestamp as number;
        const stop = program.stopTimestamp as number;

        it('returns 0 at the start of the window', () => {
            expect(calcEpgProgress(program, start)).toBe(0);
        });

        it('returns 100 at the end of the window', () => {
            expect(calcEpgProgress(program, stop)).toBe(100);
        });

        it('clamps below 0 and above 100 for out-of-window times', () => {
            expect(calcEpgProgress(program, start - 60_000)).toBe(0);
            expect(calcEpgProgress(program, stop + 60_000)).toBe(100);
        });

        it('interpolates linearly across the window', () => {
            const mid = start + (stop - start) / 2;
            expect(calcEpgProgress(program, mid)).toBeCloseTo(50, 5);
        });

        it('returns null when the window is zero-length or inverted', () => {
            expect(
                calcEpgProgress(
                    baseProgram({ stopTimestamp: start }),
                    start + 10
                )
            ).toBeNull();
            expect(
                calcEpgProgress(
                    baseProgram({ stopTimestamp: start - 1 }),
                    start
                )
            ).toBeNull();
        });
    });
});

describe('Live rail helpers', () => {
    const channelCard = (
        overrides: Partial<DashboardRailCard> = {}
    ): DashboardRailCard => ({
        id: 'card-1',
        title: 'Display Channel',
        subtitle: 'M3U · Live',
        icon: 'live_tv',
        contentType: 'live',
        link: ['/workspace', 'playlists', 'm3u-1'],
        ...overrides,
    });

    it('uses explicit EPG lookup keys before falling back to card titles', () => {
        expect(
            buildLiveEpgLookupKeys([
                channelCard({
                    title: 'Das Erste HD',
                    epgLookupKey: 'ard.de',
                }),
                channelCard({
                    id: 'card-2',
                    title: 'Das Erste HD',
                    epgLookupKey: 'ard.de',
                }),
                channelCard({
                    id: 'card-3',
                    title: 'Fallback News',
                }),
            ])
        ).toEqual(['ard.de', 'Fallback News']);
    });

    it('reads EPG programs by explicit lookup key instead of display title', () => {
        const program = { title: 'Tagesschau' } as EpgProgram;
        const wrongProgram = { title: 'Wrong channel' } as EpgProgram;
        const card = channelCard({
            title: 'Das Erste HD',
            epgLookupKey: 'ard.de',
        });

        expect(
            getLiveEpgProgramForCard(
                card,
                new Map<string, EpgProgram | null>([
                    ['Das Erste HD', wrongProgram],
                    ['ard.de', program],
                ])
            )
        ).toBe(program);
    });

    it('uses honest, semantically named title keys for favorite and recent live rails', () => {
        expect(liveRailTitleKeyForSource('favorites')).toBe(
            'WORKSPACE.DASHBOARD.LIVE_FAVORITES'
        );
        expect(liveRailTitleKeyForSource('recent')).toBe(
            'WORKSPACE.DASHBOARD.LIVE_RECENT'
        );
    });

    it('builds a stable playback-position reload key from VOD and series items only', () => {
        const first = buildPlaybackPositionReloadKey([
            { playlist_id: 'b', xtream_id: 20, type: 'series' },
            { playlist_id: 'live', xtream_id: 'stream-url', type: 'live' },
            { playlist_id: 'a', xtream_id: 10, type: 'movie' },
        ]);
        const second = buildPlaybackPositionReloadKey([
            { playlist_id: 'a', xtream_id: 10, type: 'movie' },
            { playlist_id: 'b', xtream_id: 20, type: 'series' },
        ]);

        expect(first).toBe(second);
        expect(first).toBe('a::movie::10|b::series::20');
    });
});

describe('playback-position helpers', () => {
    describe('playbackProgressPercent', () => {
        it('returns null when there is no position or no duration', () => {
            expect(playbackProgressPercent(null)).toBeNull();
            expect(
                playbackProgressPercent({ positionSeconds: 300 })
            ).toBeNull();
            expect(
                playbackProgressPercent({
                    positionSeconds: 300,
                    durationSeconds: 0,
                })
            ).toBeNull();
        });

        it('returns the integer percent watched, clamped to [0, 100]', () => {
            expect(
                playbackProgressPercent({
                    positionSeconds: 0,
                    durationSeconds: 6000,
                })
            ).toBe(0);
            expect(
                playbackProgressPercent({
                    positionSeconds: 3000,
                    durationSeconds: 6000,
                })
            ).toBe(50);
            expect(
                playbackProgressPercent({
                    positionSeconds: 6000,
                    durationSeconds: 6000,
                })
            ).toBe(100);
            // Past-end resume is clamped, not negative.
            expect(
                playbackProgressPercent({
                    positionSeconds: 7000,
                    durationSeconds: 6000,
                })
            ).toBe(100);
            // Floor rounding — 99.97% stays at 99% to avoid the "watched
            // completely" optical illusion when 1 second remains.
            expect(
                playbackProgressPercent({
                    positionSeconds: 5998.5,
                    durationSeconds: 6000,
                })
            ).toBe(99);
        });
    });

    describe('formatRemainingLabel', () => {
        it('returns null without a usable position/duration', () => {
            expect(formatRemainingLabel(null)).toBeNull();
            expect(
                formatRemainingLabel({ positionSeconds: 100 })
            ).toBeNull();
            expect(
                formatRemainingLabel({
                    positionSeconds: 100,
                    durationSeconds: -1,
                })
            ).toBeNull();
        });

        it('returns translation keys and params for sub-minute, minute, and hour-spanning remainders', () => {
            expect(
                formatRemainingLabel({
                    positionSeconds: 5970,
                    durationSeconds: 6000,
                })
            ).toEqual({
                key: 'WORKSPACE.DASHBOARD.REMAINING_SECONDS',
                params: { seconds: 30 },
            });
            expect(
                formatRemainingLabel({
                    positionSeconds: 0,
                    durationSeconds: 1800,
                })
            ).toEqual({
                key: 'WORKSPACE.DASHBOARD.REMAINING_MINUTES',
                params: { minutes: 30 },
            });
            expect(
                formatRemainingLabel({
                    positionSeconds: 0,
                    durationSeconds: 3600,
                })
            ).toEqual({
                key: 'WORKSPACE.DASHBOARD.REMAINING_HOURS',
                params: { hours: 1 },
            });
            expect(
                formatRemainingLabel({
                    positionSeconds: 600,
                    durationSeconds: 6840,
                })
            ).toEqual({
                key: 'WORKSPACE.DASHBOARD.REMAINING_HOURS_MINUTES',
                params: { hours: 1, minutes: 44 },
            });
        });

        it('clamps below zero to the translated zero-seconds state', () => {
            expect(
                formatRemainingLabel({
                    positionSeconds: 7000,
                    durationSeconds: 6000,
                })
            ).toEqual({
                key: 'WORKSPACE.DASHBOARD.REMAINING_SECONDS',
                params: { seconds: 0 },
            });
        });
    });
});

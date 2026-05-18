import type { EpgProgram, PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    buildDashboardSourceActions,
    calcEpgProgress,
    formatEpgTimeRange,
    resolveDashboardHeroArtwork,
} from './workspace-dashboard-rails.component';

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

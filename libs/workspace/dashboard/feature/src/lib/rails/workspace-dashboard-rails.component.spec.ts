import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    buildDashboardSourceActions,
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

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { BehaviorSubject } from 'rxjs';
import { M3uSeriesCatalogService } from '@iptvnator/m3u-state/series-catalog';
import {
    PlaybackPositionRuntimeBridgeService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { Channel } from '@iptvnator/shared/interfaces';
import { buildM3uSeriesCatalog } from '@iptvnator/shared/m3u-utils/series';
import type { M3uSeriesDetailRouteComponent as ComponentType } from './m3u-series-detail-route.component';
import { M3uEpisodeAccessService } from './m3u-episode-access.service';

// The shared player barrel reaches video.js, whose CJS bundle cannot be
// evaluated under the ESM jest environment.
jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

const row = (name: string) =>
    ({
        url: `http://h.example/series/u/p/${encodeURIComponent(name)}.mp4`,
        name,
        group: { title: 'Shows' },
    }) as unknown as Channel;

const CATALOG = buildM3uSeriesCatalog(
    [row('SHOW S1 E1'), row('SHOW S1 E2'), row('OTHER S1 E1')],
    'pl-1'
);
function seriesTitled(title: string) {
    const series = CATALOG.find((candidate) => candidate.title === title);
    if (!series) {
        throw new Error(`fixture series ${title} is missing`);
    }
    return series;
}
const SHOW = seriesTitled('SHOW');
const OTHER = seriesTitled('OTHER');

/** What the tests reach on the component; its members are protected. */
interface Page {
    seriesId(): number;
    episodeCount(): number;
    seasons(): Record<string, { id: string }[]>;
    onEpisodeClicked(episode: unknown): void;
    onTimeUpdate(update: { currentTime: number; duration: number }): void;
    onExternalFallbackRequested(request: unknown): void;
    playback(): {
        streamUrl: string;
        contentInfo: { playlistId: string };
    } | null;
}

/**
 * The paths the main suite leaves alone: the page without a playlist or a
 * series, and the answers that arrive after the viewer has moved on. The
 * template is emptied — these are decisions of the class, not of the view.
 */
describe('M3uSeriesDetailRouteComponent edge cases', () => {
    let M3uSeriesDetailRouteComponent: typeof ComponentType;

    beforeAll(async () => {
        ({ M3uSeriesDetailRouteComponent } =
            await import('./m3u-series-detail-route.component'));
    });

    const params = new BehaviorSubject<{ get: () => string | null }>({
        get: () => String(SHOW.id),
    });
    const portalPlayer = {
        isEmbeddedPlayer: jest.fn(() => true),
        openResolvedPlayback: jest.fn().mockResolvedValue(undefined),
        openExternalPlayback: jest.fn().mockResolvedValue(undefined),
    };
    const activePlaylist = signal<Record<string, unknown> | undefined>({
        _id: 'pl-1',
    });
    const seriesById = signal<Map<number, unknown>>(new Map());
    const access = {
        lockVersion: signal(0),
        isWithheld: jest.fn<boolean, [string, Channel]>(() => false),
        requestAccess: jest.fn(async () => true),
        recordWhenPlayed: jest.fn(),
    };
    const positionBridge = {
        supportsStorage: true,
        getSeriesPlaybackPositions: jest.fn().mockResolvedValue([]),
        savePlaybackPosition: jest.fn().mockResolvedValue(undefined),
    };

    const settle = () => new Promise((resolve) => setTimeout(resolve));

    async function render(): Promise<{
        fixture: ComponentFixture<ComponentType>;
        page: Page;
    }> {
        TestBed.configureTestingModule({
            imports: [M3uSeriesDetailRouteComponent],
            providers: [
                { provide: Router, useValue: { navigate: jest.fn() } },
                { provide: PORTAL_PLAYER, useValue: portalPlayer },
                {
                    provide: ActivatedRoute,
                    useValue: { paramMap: params, parent: {} },
                },
                {
                    provide: Store,
                    useValue: { selectSignal: () => activePlaylist },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: positionBridge,
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: { isEnabled: () => false, enrichTv: jest.fn() },
                },
                { provide: M3uSeriesCatalogService, useValue: { seriesById } },
            ],
        }).overrideComponent(M3uSeriesDetailRouteComponent, {
            // `set` for the imports too: the real ones pull video.js in.
            set: { imports: [], template: '' },
        });
        TestBed.overrideProvider(M3uEpisodeAccessService, { useValue: access });

        const fixture = TestBed.createComponent(M3uSeriesDetailRouteComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        await settle();
        return { fixture, page: fixture.componentInstance as unknown as Page };
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        params.next({ get: () => String(SHOW.id) });
        activePlaylist.set({ _id: 'pl-1' });
        seriesById.set(new Map(CATALOG.map((s) => [s.id, s])));
        access.isWithheld.mockReset().mockReturnValue(false);
        access.requestAccess.mockReset().mockResolvedValue(true);
        access.recordWhenPlayed.mockReset();
        portalPlayer.isEmbeddedPlayer.mockReset().mockReturnValue(true);
        portalPlayer.openResolvedPlayback
            .mockReset()
            .mockResolvedValue(undefined);
        portalPlayer.openExternalPlayback
            .mockReset()
            .mockResolvedValue(undefined);
        positionBridge.getSeriesPlaybackPositions
            .mockReset()
            .mockResolvedValue([]);
        positionBridge.savePlaybackPosition
            .mockReset()
            .mockResolvedValue(undefined);
    });

    it('plays without request headers or saved progress when no playlist is active', async () => {
        activePlaylist.set(undefined);
        const { page } = await render();

        page.onEpisodeClicked(page.seasons()['1'][0]);
        page.onTimeUpdate({ currentTime: 30, duration: 1200 });
        await settle();

        expect(page.playback()?.streamUrl).toContain('/series/');
        expect(page.playback()?.contentInfo.playlistId).toBe('');
        expect(
            positionBridge.getSeriesPlaybackPositions
        ).not.toHaveBeenCalled();
        expect(positionBridge.savePlaybackPosition).not.toHaveBeenCalled();
    });

    it('shows an empty page when the route carries no series id', async () => {
        params.next({ get: () => null });
        const { page } = await render();

        expect(page.seriesId()).toBe(0);
        expect(page.episodeCount()).toBe(0);
        expect(page.seasons()).toEqual({});
        expect(
            positionBridge.getSeriesPlaybackPositions
        ).not.toHaveBeenCalled();
    });

    it('keeps the episode when the route names the same series again', async () => {
        // `0` and `-0` are two values to the signal and one series to the
        // page: only a different series may stop what is playing.
        seriesById.set(new Map([[0, { ...SHOW, id: 0 }]]));
        params.next({ get: () => '0' });
        const { fixture, page } = await render();
        page.onEpisodeClicked(page.seasons()['1'][0]);
        expect(page.playback()).not.toBeNull();

        params.next({ get: () => '-0' });
        fixture.detectChanges();
        await settle();

        expect(Object.is(page.seriesId(), -0)).toBe(true);
        expect(page.playback()).not.toBeNull();
    });

    it('saves no progress for a tick with no episode or no position', async () => {
        const { page } = await render();

        // Nothing mounted: a late tick from a player already closed.
        page.onTimeUpdate({ currentTime: 30, duration: 1200 });
        // Mounted, but the media element has no position yet.
        page.onEpisodeClicked(page.seasons()['1'][0]);
        page.onTimeUpdate({ currentTime: Number.NaN, duration: 1200 });
        await settle();

        expect(positionBridge.savePlaybackPosition).not.toHaveBeenCalled();
    });

    it('launches the fallback player without a history write when nothing is mounted', async () => {
        const { page } = await render();
        const trackLaunch = jest.fn();

        page.onExternalFallbackRequested({
            player: 'mpv',
            playback: { streamUrl: 'http://h.example/a.mp4', contentInfo: {} },
            trackLaunch,
        });

        expect(access.recordWhenPlayed).not.toHaveBeenCalled();
        expect(portalPlayer.openExternalPlayback).toHaveBeenCalledWith(
            { streamUrl: 'http://h.example/a.mp4' },
            'mpv'
        );
        expect(trackLaunch).toHaveBeenCalledTimes(1);
    });

    it('drops a click whose positions arrive after another series opened', async () => {
        let deliver: (rows: unknown[]) => void = () => undefined;
        positionBridge.getSeriesPlaybackPositions.mockReturnValueOnce(
            new Promise<unknown[]>((resolve) => {
                deliver = resolve;
            })
        );
        const { fixture, page } = await render();
        page.onEpisodeClicked(page.seasons()['1'][0]);

        params.next({ get: () => String(OTHER.id) });
        fixture.detectChanges();
        await settle();
        deliver([]);
        await settle();

        expect(page.playback()).toBeNull();
        expect(access.recordWhenPlayed).not.toHaveBeenCalled();
    });

    it('ignores an episode the series does not hold', async () => {
        const { page } = await render();

        page.onEpisodeClicked({ id: 'not-in-this-series' });

        expect(page.playback()).toBeNull();
        expect(access.isWithheld).not.toHaveBeenCalled();
    });

    it('ignores a click that lands after the series left the catalog', async () => {
        const { fixture, page } = await render();
        const episode = page.seasons()['1'][0];
        seriesById.set(new Map());
        fixture.detectChanges();

        page.onEpisodeClicked(episode);

        expect(page.playback()).toBeNull();
        expect(access.isWithheld).not.toHaveBeenCalled();
    });

    it('logs a failed MPV or VLC launch instead of rejecting unhandled', async () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);
        portalPlayer.openResolvedPlayback.mockRejectedValue(
            new Error('player missing')
        );
        const warn = jest.spyOn(console, 'warn').mockImplementation();
        try {
            const { page } = await render();

            page.onEpisodeClicked(page.seasons()['1'][0]);
            await settle();

            expect(page.playback()).toBeNull();
            expect(warn).toHaveBeenCalledWith(
                '[M3uSeriesDetail]',
                'External episode launch failed',
                expect.anything()
            );
        } finally {
            warn.mockRestore();
        }
    });
});

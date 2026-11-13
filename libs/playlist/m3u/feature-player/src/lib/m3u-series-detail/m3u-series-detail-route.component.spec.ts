import { NgTemplateOutlet } from '@angular/common';
import {
    Component,
    Directive,
    TemplateRef,
    contentChild,
    input,
    output,
    signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
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

/**
 * The shared shell, season grid and inline player have their own suites;
 * stubbing them here keeps this spec about what the route component itself
 * decides — which series, which episode, what payload — and avoids dragging
 * the translate and player infrastructure into it.
 */
@Directive({ selector: '[appDetailActions]', standalone: true })
class StubDetailActionsDirective {
    constructor(readonly template: TemplateRef<unknown>) {}
}

@Component({
    selector: 'app-vod-more-menu',
    standalone: true,
    template: '',
})
class StubMoreMenuComponent {
    readonly sections = input<{ items: { testId?: string }[] }[]>([]);
    readonly label = input('');
    readonly testId = input<string | null>(null);
    readonly selected = output<string>();
}

@Component({
    selector: 'app-portal-detail-shell',
    standalone: true,
    imports: [NgTemplateOutlet],
    // The real shell stamps the host's actions template into its hero.
    template: `<ng-container
            [ngTemplateOutlet]="actions()?.template ?? null"
        /><ng-content />`,
})
class StubShellComponent {
    readonly actions = contentChild(StubDetailActionsDirective);
    readonly title = input<string>();
    readonly description = input<string>();
    readonly posterUrl = input<string>();
    readonly backdropUrl = input<string>();
    readonly backAvailable = input(true);
    readonly playbackActive = input(false);
    readonly backClicked = output<void>();
    readonly closePlayerRequested = output<void>();
}

@Component({
    selector: 'app-season-container',
    standalone: true,
    template: '',
})
class StubSeasonContainerComponent {
    readonly seasons = input<Record<string, unknown[]>>({});
    readonly seriesId = input<number>(0);
    readonly playlistId = input<string>('');
    readonly seriesTitle = input<string>('');
    readonly downloadAdapter = input<unknown>(null);
    readonly downloadsEnabled = input(true);
    readonly hasUnloadedSeasons = input(false);
    readonly playingEpisodeId = input<number | null>(null);
    readonly playbackPositions = input<Map<number, unknown>>(new Map());
    readonly seasonWatchBatchRunning = input(false);
    readonly episodeClicked = output<unknown>();
    readonly episodeRestartRequested = output<unknown>();
    readonly playbackToggleRequested = output<unknown>();
    readonly seasonPlaybackToggleRequested = output<unknown>();
    readonly seriesPlaybackToggleRequested = output<unknown>();

    /** What the season toggle hands the host; set by the test. */
    seasonBatch: unknown = null;
    // The real presenter decides the batch; the host only has to start it
    // from its menu and persist what comes back.
    readonly watchPresenter = {
        seasonWatchToggleVisible: () => true,
        selectedSeasonFullyWatched: () => false,
        seasonWatchEligibleCount: () => 2,
        seriesMenuVisible: () => true,
        seriesFullyWatched: () => false,
        seriesWatchEligibleCount: () => 3,
        seriesCountKnown: () => true,
        seriesActionDisabled: () => false,
        toggleSeasonWatched: () =>
            this.seasonPlaybackToggleRequested.emit(this.seasonBatch),
        toggleSeriesWatched: () => undefined,
    };
}

@Directive({ selector: '[appDetailMeta]', standalone: true })
class StubDetailMetaDirective {
    constructor(readonly template: TemplateRef<unknown>) {}
}

@Component({
    selector: 'app-portal-inline-player',
    standalone: true,
    template: '',
})
class StubInlinePlayerComponent {
    readonly playbackSessionKey = input<string>('');
    readonly playback = input<unknown>(null);
    readonly seriesTitle = input<string | null>(null);
    readonly seriesEpisodes = input<unknown>(null);
    readonly episodePlaybackPositions = input<Map<number, unknown>>(new Map());
    readonly closed = output<void>();
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly upNextEpisodeSelected = output<{ episode: unknown }>();
    readonly volume = input(1);
    readonly externalFallbackRequested = output<unknown>();
}

const row = (name: string) =>
    ({
        url: `http://h.example/series/u/p/${encodeURIComponent(name)}.mp4`,
        name,
        group: { title: 'Shows' },
        tvg: { logo: 'http://logo.example/show.png' },
    }) as unknown as Channel;

const dashRow = (name: string) =>
    ({
        ...row(name),
        url: `http://h.example/series/u/p/${encodeURIComponent(name)}.mpd`,
    }) as unknown as Channel;

const CATALOG = buildM3uSeriesCatalog(
    [
        row('SHOW S1 E1'),
        row('SHOW S1 E2'),
        row('SHOW S2 E1'),
        dashRow('DASH SHOW S1 E1'),
        // DRM kept only in the raw block, as older imports store it.
        {
            ...row('KEYED SHOW S1 E1'),
            raw: [
                '#KODIPROP:inputstream.adaptive.license_type=clearkey',
                `#KODIPROP:inputstream.adaptive.license_key=${'1'.repeat(32)}:${'a'.repeat(32)}`,
            ].join('\n'),
        } as unknown as Channel,
        // One URL, two rows: a provider reuses a stream address and tells
        // the episodes apart by their own headers.
        {
            ...row('TWIN S1 E1'),
            url: 'http://h.example/series/u/p/twin.mp4',
            http: { 'user-agent': 'first' },
        } as unknown as Channel,
        {
            ...row('TWIN S1 E2'),
            url: 'http://h.example/series/u/p/twin.mp4',
            http: { 'user-agent': 'second' },
        } as unknown as Channel,
    ],
    'pl-1'
);
/** The catalog as a rebuild publishes it: equal content, new objects. */
const rebuiltCatalog = () =>
    new Map(
        CATALOG.map((series) => [
            series.id,
            {
                ...series,
                seasons: new Map(
                    [...series.seasons].map(([season, episodes]) => [
                        season,
                        episodes.map((episode) => ({
                            ...episode,
                            channel: { ...episode.channel },
                        })),
                    ])
                ),
            },
        ])
    );
function seriesTitled(title: string) {
    const series = CATALOG.find((candidate) => candidate.title === title);
    if (!series) {
        throw new Error(`fixture series ${title} is missing`);
    }
    return series;
}
const SHOW = seriesTitled('SHOW');
const DASH_SHOW = seriesTitled('DASH SHOW');
const KEYED_SHOW = seriesTitled('KEYED SHOW');

describe('M3uSeriesDetailRouteComponent', () => {
    let M3uSeriesDetailRouteComponent: typeof ComponentType;

    beforeAll(async () => {
        ({ M3uSeriesDetailRouteComponent } =
            await import('./m3u-series-detail-route.component'));
    });

    const params = new BehaviorSubject({ get: () => String(SHOW.id) });
    const navigate = jest.fn();
    const portalPlayer = {
        isEmbeddedPlayer: jest.fn(() => true),
        openResolvedPlayback: jest.fn().mockResolvedValue(undefined),
        openExternalPlayback: jest.fn().mockResolvedValue(undefined),
    };
    const lockVersion = signal(0);
    const activePlaylist = signal<Record<string, unknown>>({ _id: 'pl-1' });
    const seriesById = signal<Map<number, unknown>>(new Map());
    const access = {
        lockVersion,
        isWithheld: jest.fn<boolean, [string, Channel]>(() => false),
        requestAccess: jest.fn(async () => true),
        recordWhenPlayed: jest.fn(),
    };
    const positionBridge = {
        supportsStorage: true,
        getSeriesPlaybackPositions: jest.fn().mockResolvedValue([]),
        savePlaybackPosition: jest.fn().mockResolvedValue(undefined),
        clearPlaybackPosition: jest.fn().mockResolvedValue(undefined),
        savePlaybackPositionsBatch: jest.fn().mockResolvedValue(undefined),
        clearPlaybackPositionsBatch: jest.fn().mockResolvedValue(undefined),
    };

    async function render(): Promise<ComponentFixture<ComponentType>> {
        TestBed.configureTestingModule({
            imports: [M3uSeriesDetailRouteComponent],
            providers: [
                { provide: Router, useValue: { navigate } },
                { provide: PORTAL_PLAYER, useValue: portalPlayer },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        paramMap: params,
                        snapshot: { data: {} },
                        parent: { outlet: 'primary' },
                    },
                },
                {
                    provide: Store,
                    useValue: {
                        selectSignal: () => activePlaylist,
                    },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: positionBridge,
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => false,
                        enrichTv: jest.fn(),
                    },
                },
                {
                    provide: M3uSeriesCatalogService,
                    useValue: { seriesById },
                },
            ],
        }).overrideComponent(M3uSeriesDetailRouteComponent, {
            // `set` rather than add/remove: naming the real components would
            // mean importing them here, and that import pulls video.js in
            // before the module mock above can take effect.
            set: {
                imports: [
                    MockPipe(TranslatePipe, (value) => `${value}`),
                    StubDetailActionsDirective,
                    StubDetailMetaDirective,
                    StubMoreMenuComponent,
                    StubShellComponent,
                    StubSeasonContainerComponent,
                    StubInlinePlayerComponent,
                ],
            },
        });

        TestBed.overrideProvider(M3uEpisodeAccessService, { useValue: access });
        const fixture = TestBed.createComponent(M3uSeriesDetailRouteComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        // Let the positions read settle: an episode opened while it is in
        // flight waits for it.
        await settle();
        return fixture;
    }

    const settle = () => new Promise((resolve) => setTimeout(resolve));

    beforeEach(() => {
        TestBed.resetTestingModule();
        params.next({ get: () => String(SHOW.id) });
        navigate.mockReset();
        activePlaylist.set({ _id: 'pl-1' });
        seriesById.set(new Map(CATALOG.map((s) => [s.id, s])));
        access.isWithheld.mockReset().mockReturnValue(false);
        access.requestAccess.mockReset().mockResolvedValue(true);
        access.recordWhenPlayed.mockReset();
        portalPlayer.isEmbeddedPlayer.mockReset().mockReturnValue(true);
        portalPlayer.openResolvedPlayback
            .mockReset()
            .mockResolvedValue(undefined);
        positionBridge.getSeriesPlaybackPositions
            .mockReset()
            .mockResolvedValue([]);
        positionBridge.savePlaybackPosition
            .mockReset()
            .mockResolvedValue(undefined);
        positionBridge.clearPlaybackPosition
            .mockReset()
            .mockResolvedValue(undefined);
    });

    function savedPosition(
        episodeId: number,
        positionSeconds: number,
        durationSeconds?: number
    ) {
        return {
            contentXtreamId: episodeId,
            contentType: 'episode' as const,
            seriesXtreamId: SHOW.id,
            seasonNumber: 1,
            episodeNumber: 1,
            positionSeconds,
            durationSeconds,
        };
    }

    it('renders the series the route names', async () => {
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seriesTitle(): string;
            seasonCount(): number;
            episodeCount(): number;
        };

        expect(component.seriesTitle()).toBe('SHOW');
        expect(component.seasonCount()).toBe(2);
        expect(component.episodeCount()).toBe(3);
    });

    it('feeds the shared season component string-keyed seasons', async () => {
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
        };

        expect(Object.keys(component.seasons()).sort()).toEqual(['1', '2']);
        expect(component.seasons()['1']).toHaveLength(2);
    });

    it('shows no player until an episode is chosen', async () => {
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            playback(): unknown;
            playingEpisodeId(): number | null;
        };

        expect(component.playback()).toBeNull();
        expect(component.playingEpisodeId()).toBeNull();
    });

    it('builds a non-live playback payload for the chosen episode', async () => {
        // An episode is a finished file; marking it live would cost the
        // viewer the seekable timeline and the resume position.
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, { direct_source: string }[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): { isLive: boolean; streamUrl: string } | null;
        };

        component.onEpisodeClicked(component.seasons()['1'][0]);

        expect(component.playback()?.isLive).toBe(false);
        expect(component.playback()?.streamUrl).toContain('/series/');
    });

    it('waits for the saved positions before opening an episode', async () => {
        // A click can beat the read. Opening at once would start at zero,
        // and the first tick would overwrite the resume point.
        let deliver: (rows: unknown[]) => void = () => undefined;
        positionBridge.getSeriesPlaybackPositions.mockReturnValue(
            new Promise<unknown[]>((resolve) => {
                deliver = resolve;
            })
        );
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, { id: string }[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): { startTime?: number } | null;
        };
        const first = component.seasons()['1'][0];

        component.onEpisodeClicked(first);
        expect(component.playback()).toBeNull();

        deliver([savedPosition(Number(first.id), 300, 1200)]);
        await settle();

        expect(component.playback()?.startTime).toBe(300);
    });

    it('stops the episode of the series being left when the route moves on', async () => {
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): unknown;
        };
        component.onEpisodeClicked(component.seasons()['1'][0]);
        expect(component.playback()).not.toBeNull();

        // Same component, another `:seriesId`.
        params.next({ get: () => String(seriesTitled('TWIN').id) });
        fixture.detectChanges();
        await settle();
        expect(component.playback()).toBeNull();

        params.next({ get: () => String(SHOW.id) });
        fixture.detectChanges();
        await settle();
        expect(component.playback()).toBeNull();
    });

    it('hands the player the volume the viewer last set', async () => {
        // The inline player defaults to full volume; a viewer who muted
        // the M3U player must not have an episode start loud.
        localStorage.setItem('volume', '0.25');
        try {
            const fixture = await render();
            const component = fixture.componentInstance as unknown as {
                seasons(): Record<string, unknown[]>;
                onEpisodeClicked(episode: unknown): void;
            };
            component.onEpisodeClicked(component.seasons()['1'][0]);
            fixture.detectChanges();

            expect(
                fixture.debugElement
                    .query(By.directive(StubInlinePlayerComponent))
                    .componentInstance.volume()
            ).toBe(0.25);
        } finally {
            localStorage.removeItem('volume');
        }
    });

    it('launches the external player the failure overlay asks for', async () => {
        portalPlayer.openExternalPlayback
            .mockReset()
            .mockResolvedValue(undefined);
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): Record<string, unknown> | null;
        };
        component.onEpisodeClicked(component.seasons()['1'][0]);
        fixture.detectChanges();
        const trackLaunch = jest.fn();

        fixture.debugElement
            .query(By.directive(StubInlinePlayerComponent))
            .componentInstance.externalFallbackRequested.emit({
                player: 'vlc',
                playback: component.playback(),
                trackLaunch,
            });

        // Without the episode identity: an external launch is untracked.
        expect(portalPlayer.openExternalPlayback).toHaveBeenCalledWith(
            expect.not.objectContaining({ contentInfo: expect.anything() }),
            'vlc'
        );
        expect(portalPlayer.openExternalPlayback).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'SHOW S1 E1' }),
            'vlc'
        );
        expect(trackLaunch).toHaveBeenCalledTimes(1);
    });

    it('tells the inline player which episode is playing', async () => {
        // The shared player shows its fullscreen episode panel only for a
        // playback that identifies an episode.
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, { id: string }[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): { contentInfo?: Record<string, unknown> } | null;
        };
        const second = component.seasons()['1'][1];

        component.onEpisodeClicked(second);

        expect(component.playback()?.contentInfo).toEqual({
            playlistId: 'pl-1',
            contentXtreamId: Number(second.id),
            contentType: 'episode',
            seriesXtreamId: SHOW.id,
            seasonNumber: 1,
            episodeNumber: 2,
        });
    });

    it('plays the episode picked in the episode panel of the player', async () => {
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, { id: string }[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): { title: string } | null;
        };
        component.onEpisodeClicked(component.seasons()['1'][0]);
        fixture.detectChanges();

        fixture.debugElement
            .query(By.directive(StubInlinePlayerComponent))
            .componentInstance.upNextEpisodeSelected.emit({
                episode: component.seasons()['2'][0],
            });

        expect(component.playback()?.title).toBe('SHOW S2 E1');
    });

    it('plays the row of the episode clicked when two rows share a URL', async () => {
        params.next({ get: () => String(seriesTitled('TWIN').id) });
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): { title: string; userAgent?: string } | null;
        };

        component.onEpisodeClicked(component.seasons()['1'][1]);

        expect(component.playback()?.title).toBe('TWIN S1 E2');
        expect(component.playback()?.userAgent).toBe('second');
    });

    it('hands the episode to MPV or VLC instead of an empty inline stage', async () => {
        // The inline player has no engine for an external player: before
        // this, the page switched to Watch and nothing played anywhere.
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);
        const first = SHOW.seasons.get(1)?.[0];
        positionBridge.getSeriesPlaybackPositions.mockResolvedValue([
            savedPosition(Number(first?.id), 640, 2400),
        ]);
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): unknown;
        };

        component.onEpisodeClicked(component.seasons()['1'][0]);

        expect(component.playback()).toBeNull();
        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                isLive: false,
                startTime: 640,
                streamUrl: expect.stringContaining('/series/'),
            }),
            true
        );
    });

    it('keeps a DASH episode inline even with an external player saved', async () => {
        // The external players cannot carry KODIPROP keys; the `:view`
        // player keeps DASH inline under every setting, and so does this.
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);
        params.next({ get: () => String(DASH_SHOW.id) });
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): { streamUrl: string } | null;
        };

        component.onEpisodeClicked(component.seasons()['1'][0]);

        expect(portalPlayer.openResolvedPlayback).not.toHaveBeenCalled();
        expect(component.playback()?.streamUrl).toContain('.mpd');
    });

    it('keeps an episode with raw-only DRM inline with an external player saved', async () => {
        // MPV and VLC cannot receive KODIPROP keys, wherever they are kept.
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);
        params.next({ get: () => String(KEYED_SHOW.id) });
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): { drm?: unknown } | null;
        };

        component.onEpisodeClicked(component.seasons()['1'][0]);

        expect(portalPlayer.openResolvedPlayback).not.toHaveBeenCalled();
        expect(component.playback()?.drm).toEqual(
            expect.objectContaining({ licenseType: 'clearkey' })
        );
    });

    it('plays from the beginning when the viewer asks to restart', async () => {
        const first = SHOW.seasons.get(1)?.[0];
        positionBridge.getSeriesPlaybackPositions.mockResolvedValue([
            savedPosition(Number(first?.id), 640, 2400),
        ]);
        const fixture = await render();
        const season = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        ).componentInstance as StubSeasonContainerComponent;
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            playback(): { startTime?: number } | null;
        };

        season.episodeRestartRequested.emit(component.seasons()['1'][0]);

        expect(component.playback()).not.toBeNull();
        expect(component.playback()?.startTime).toBeUndefined();
    });

    it('records an episode handed to MPV or VLC by the failure overlay', async () => {
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): Record<string, unknown> | null;
            onExternalFallbackRequested(request: unknown): void;
        };
        component.onEpisodeClicked(component.seasons()['1'][0]);
        access.recordWhenPlayed.mockClear();

        component.onExternalFallbackRequested({
            playback: component.playback(),
            player: 'mpv',
            trackLaunch: jest.fn(),
        });

        expect(access.recordWhenPlayed).toHaveBeenCalledWith(
            'pl-1',
            expect.objectContaining({ name: 'SHOW S1 E1' }),
            null
        );
    });

    it('keeps the playing payload when only Recently viewed changes', async () => {
        // The history write rewrites the playlist meta; a new payload object
        // would remount the player mid-episode.
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): unknown;
        };
        component.onEpisodeClicked(component.seasons()['1'][0]);
        const before = component.playback();

        activePlaylist.set({ _id: 'pl-1', recentlyViewed: [{ id: 'x' }] });

        expect(component.playback()).toBe(before);

        activePlaylist.set({ _id: 'pl-1', userAgent: 'Synthetic/3.0' });

        expect(component.playback()).not.toBe(before);
    });

    describe('catalog rebuilds while an episode plays', () => {
        // Sync and refresh re-publish the rows and a lock flip rebuilds the
        // catalog. A new payload object remounts the player at the offset
        // the episode was opened at.
        type Playing = {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            onTimeUpdate(update: {
                currentTime: number;
                duration: number;
            }): void;
            playback(): unknown;
        };

        async function playFirstEpisode() {
            const fixture = await render();
            const component = fixture.componentInstance as unknown as Playing;
            component.onEpisodeClicked(component.seasons()['1'][0]);
            fixture.detectChanges();
            return { fixture, component, before: component.playback() };
        }

        it('keeps the playing payload when the catalog is rebuilt', async () => {
            const { fixture, component, before } = await playFirstEpisode();
            expect(before).not.toBeNull();

            seriesById.set(rebuiltCatalog());
            fixture.detectChanges();

            expect(component.playback()).toBe(before);
        });

        it('keeps an unlocked episode playing when the lock flips', async () => {
            const { fixture, component, before } = await playFirstEpisode();

            seriesById.set(rebuiltCatalog());
            lockVersion.update((value) => value + 1);
            fixture.detectChanges();

            expect(component.playback()).toBe(before);
        });

        it('keeps the episode mounted while the rows reload', async () => {
            const { fixture, component, before } = await playFirstEpisode();

            seriesById.set(new Map());
            fixture.detectChanges();
            expect(component.playback()).toBe(before);

            seriesById.set(rebuiltCatalog());
            fixture.detectChanges();
            expect(component.playback()).toBe(before);
        });

        it('neither re-reads the positions nor releases the save throttle', async () => {
            const { fixture, component } = await playFirstEpisode();
            component.onTimeUpdate({ currentTime: 1200, duration: 2400 });
            await settle();
            expect(positionBridge.savePlaybackPosition).toHaveBeenCalledTimes(
                1
            );
            positionBridge.getSeriesPlaybackPositions.mockClear();

            seriesById.set(rebuiltCatalog());
            fixture.detectChanges();
            await settle();
            // A released throttle would write this tick at once; after a
            // remount that tick is the stale opening offset.
            component.onTimeUpdate({ currentTime: 1201, duration: 2400 });
            await settle();

            expect(
                positionBridge.getSeriesPlaybackPositions
            ).not.toHaveBeenCalled();
            expect(positionBridge.savePlaybackPosition).toHaveBeenCalledTimes(
                1
            );
        });
    });

    it('marks a season watched from the hero menu', async () => {
        positionBridge.savePlaybackPositionsBatch.mockClear();
        const fixture = await render();
        fixture.detectChanges();
        const menu = fixture.debugElement.query(
            By.directive(StubMoreMenuComponent)
        );
        expect(menu).not.toBeNull();
        const stub = menu.componentInstance as StubMoreMenuComponent;
        expect(
            stub
                .sections()
                .flatMap((section) => section.items)
                .map((item) => item.testId)
        ).toEqual(['toggle-season-watched', 'toggle-series-watched']);

        const first = Number(SHOW.seasons.get(1)?.[0].id);
        (
            fixture.debugElement.query(
                By.directive(StubSeasonContainerComponent)
            ).componentInstance as StubSeasonContainerComponent
        ).seasonBatch = {
            markWatched: true,
            requests: [
                {
                    contentXtreamId: first,
                    nextPosition: savedPosition(first, 1200, 1200),
                },
            ],
        };
        stub.selected.emit('season-watched');
        await settle();

        expect(positionBridge.savePlaybackPositionsBatch).toHaveBeenCalledWith(
            'pl-1',
            [expect.objectContaining({ contentXtreamId: first })]
        );
    });

    describe('parental lock', () => {
        type Locked = {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): unknown;
        };

        it('asks for the PIN and plays nothing when it is refused', async () => {
            access.isWithheld.mockReturnValue(true);
            access.requestAccess.mockResolvedValue(false);
            const fixture = await render();
            const component = fixture.componentInstance as unknown as Locked;

            component.onEpisodeClicked(component.seasons()['1'][0]);
            await settle();

            expect(access.requestAccess).toHaveBeenCalledTimes(1);
            expect(component.playback()).toBeNull();
            expect(access.recordWhenPlayed).not.toHaveBeenCalled();
        });

        it('plays once the PIN is entered', async () => {
            access.isWithheld.mockReturnValue(true);
            access.requestAccess.mockImplementation(async () => {
                // Entering the PIN unlocks the app.
                access.isWithheld.mockReturnValue(false);
                return true;
            });
            const fixture = await render();
            const component = fixture.componentInstance as unknown as Locked;

            component.onEpisodeClicked(component.seasons()['1'][0]);
            await settle();

            expect(component.playback()).not.toBeNull();
        });

        it('does not launch an external player without the PIN', async () => {
            portalPlayer.isEmbeddedPlayer.mockReturnValue(false);
            access.isWithheld.mockReturnValue(true);
            access.requestAccess.mockResolvedValue(false);
            const fixture = await render();
            const component = fixture.componentInstance as unknown as Locked;

            component.onEpisodeClicked(component.seasons()['1'][0]);
            await settle();

            expect(portalPlayer.openResolvedPlayback).not.toHaveBeenCalled();
        });

        it('stops the episode playing when its group is locked again', async () => {
            const fixture = await render();
            const component = fixture.componentInstance as unknown as Locked;
            component.onEpisodeClicked(component.seasons()['1'][0]);
            fixture.detectChanges();
            expect(component.playback()).not.toBeNull();

            access.isWithheld.mockReturnValue(true);
            lockVersion.update((value) => value + 1);
            fixture.detectChanges();

            expect(component.playback()).toBeNull();
        });
    });

    describe('recently viewed', () => {
        it('records an inline episode under its playlist-scoped session', async () => {
            const fixture = await render();
            const component = fixture.componentInstance as unknown as {
                seasons(): Record<string, unknown[]>;
                onEpisodeClicked(episode: unknown): void;
                playbackSessionKey(): string;
            };

            component.onEpisodeClicked(component.seasons()['1'][0]);

            const [playlistId, channel, sessionKey] =
                access.recordWhenPlayed.mock.calls[0];
            expect(playlistId).toBe('pl-1');
            expect((channel as Channel).url).toContain('SHOW%20S1%20E1');
            // The key the inline player confirms playback under.
            expect(sessionKey).toBe(component.playbackSessionKey());
            expect(sessionKey).toContain('pl-1');
        });

        it('records an external launch by its URL', async () => {
            portalPlayer.isEmbeddedPlayer.mockReturnValue(false);
            const fixture = await render();
            const component = fixture.componentInstance as unknown as {
                seasons(): Record<string, unknown[]>;
                onEpisodeClicked(episode: unknown): void;
            };

            component.onEpisodeClicked(component.seasons()['1'][0]);

            expect(access.recordWhenPlayed).toHaveBeenCalledWith(
                'pl-1',
                expect.objectContaining({ name: 'SHOW S1 E1' }),
                null
            );
        });
    });

    it('moves the session key with the episode', async () => {
        // The key identifies the mounted content: if it did not move, the
        // engine would keep playing the previous episode's stream.
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playbackSessionKey(): string;
        };

        const before = component.playbackSessionKey();
        component.onEpisodeClicked(component.seasons()['1'][0]);
        const first = component.playbackSessionKey();
        component.onEpisodeClicked(component.seasons()['1'][1]);

        expect(first).not.toBe(before);
        expect(component.playbackSessionKey()).not.toBe(first);
    });

    it('opens an episode at the offset storage remembers', async () => {
        // Without this the resume feature is inert: the badges show
        // progress while every click still starts the episode at zero.
        const first = SHOW.seasons.get(1)?.[0];
        positionBridge.getSeriesPlaybackPositions.mockResolvedValue([
            savedPosition(Number(first?.id), 640, 2400),
        ]);

        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): { startTime?: number } | null;
        };

        component.onEpisodeClicked(component.seasons()['1'][0]);

        expect(component.playback()?.startTime).toBe(640);
    });

    it('starts a finished episode over rather than at the credits', async () => {
        const first = SHOW.seasons.get(1)?.[0];
        positionBridge.getSeriesPlaybackPositions.mockResolvedValue([
            savedPosition(Number(first?.id), 2396, 2400),
        ]);

        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): { startTime?: number } | null;
        };

        component.onEpisodeClicked(component.seasons()['1'][0]);

        expect(component.playback()?.startTime).toBeUndefined();
    });

    it('keeps the opened offset fixed while the episode plays', async () => {
        // The offset is captured at selection. Reading it live from the
        // positions map would let this episode's own progress ticks feed
        // the player a `startTime` that chases playback and re-seeks it.
        const first = SHOW.seasons.get(1)?.[0];
        positionBridge.getSeriesPlaybackPositions.mockResolvedValue([
            savedPosition(Number(first?.id), 640, 2400),
        ]);

        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            onTimeUpdate(update: {
                currentTime: number;
                duration: number;
            }): void;
            playback(): { startTime?: number } | null;
        };

        component.onEpisodeClicked(component.seasons()['1'][0]);
        component.onTimeUpdate({ currentTime: 900, duration: 2400 });
        await fixture.whenStable();

        expect(component.playback()?.startTime).toBe(640);
    });

    it('saves no tick from before the resume point, then saves as usual', async () => {
        // An engine can report ~0 before its seek to `startTime` lands; the
        // first save is not throttled, so that tick replaced the resume point.
        const first = SHOW.seasons.get(1)?.[0];
        positionBridge.getSeriesPlaybackPositions.mockResolvedValue([
            savedPosition(Number(first?.id), 640, 2400),
        ]);

        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            onTimeUpdate(update: {
                currentTime: number;
                duration: number;
            }): void;
        };
        positionBridge.savePlaybackPosition.mockClear();

        component.onEpisodeClicked(component.seasons()['1'][0]);
        component.onTimeUpdate({ currentTime: 0.2, duration: 2400 });
        await fixture.whenStable();

        expect(positionBridge.savePlaybackPosition).not.toHaveBeenCalled();

        component.onTimeUpdate({ currentTime: 641, duration: 2400 });
        await fixture.whenStable();

        expect(positionBridge.savePlaybackPosition).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ positionSeconds: 641 })
        );
    });

    it('starts an unwatched episode from the beginning', async () => {
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seasons(): Record<string, unknown[]>;
            onEpisodeClicked(episode: unknown): void;
            playback(): { startTime?: number } | null;
        };

        component.onEpisodeClicked(component.seasons()['1'][0]);

        expect(component.playback()?.startTime).toBeUndefined();
    });

    it('returns to the series list from the back action', async () => {
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            onBack(): void;
        };

        component.onBack();

        // Relative to the parent, because `series/:seriesId` is two
        // segments: `['..', 'series']` from here resolves to
        // `/series/series`, which the generic player route answers.
        expect(navigate).toHaveBeenCalledWith(
            ['series'],
            expect.objectContaining({ relativeTo: expect.anything() })
        );
    });

    it('renders nothing playable for an unknown series id', async () => {
        params.next({ get: () => '999999' });
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            seriesTitle(): string;
            seasons(): Record<string, unknown[]>;
            playback(): unknown;
        };

        expect(component.seriesTitle()).toBe('');
        expect(component.seasons()).toEqual({});
        expect(component.playback()).toBeNull();
    });
});

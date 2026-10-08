import {
    Component,
    Directive,
    TemplateRef,
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
@Component({
    selector: 'app-portal-detail-shell',
    standalone: true,
    template: '<ng-content />',
})
class StubShellComponent {
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
    readonly episodeClicked = output<unknown>();
    readonly playbackToggleRequested = output<unknown>();
    readonly seasonPlaybackToggleRequested = output<unknown>();
    readonly seriesPlaybackToggleRequested = output<unknown>();
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
        tvg: { logo: 'http://logo/show.png' },
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
function seriesTitled(title: string) {
    const series = CATALOG.find((candidate) => candidate.title === title);
    if (!series) {
        throw new Error(`fixture series ${title} is missing`);
    }
    return series;
}
const SHOW = seriesTitled('SHOW');
const DASH_SHOW = seriesTitled('DASH SHOW');

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
                        selectSignal: () => signal({ _id: 'pl-1' }),
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
                    useValue: {
                        seriesById: () =>
                            new Map(CATALOG.map((s) => [s.id, s])),
                    },
                },
            ],
        }).overrideComponent(M3uSeriesDetailRouteComponent, {
            // `set` rather than add/remove: naming the real components would
            // mean importing them here, and that import pulls video.js in
            // before the module mock above can take effect.
            set: {
                imports: [
                    MockPipe(TranslatePipe, (value) => `${value}`),
                    StubDetailMetaDirective,
                    StubShellComponent,
                    StubSeasonContainerComponent,
                    StubInlinePlayerComponent,
                ],
            },
        });

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

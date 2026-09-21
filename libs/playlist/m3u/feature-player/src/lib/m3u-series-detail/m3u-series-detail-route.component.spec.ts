import {
    Component,
    Directive,
    TemplateRef,
    input,
    output,
    signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { BehaviorSubject } from 'rxjs';
import { M3uCatalogIndexService } from '@iptvnator/m3u-state';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
import { buildM3uSeriesCatalog } from '@iptvnator/shared/m3u-utils';
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
}

const row = (name: string) =>
    ({
        url: `http://h.example/series/u/p/${encodeURIComponent(name)}.mp4`,
        name,
        group: { title: 'Shows' },
        tvg: { logo: 'http://logo/show.png' },
    }) as unknown as Channel;

const CATALOG = buildM3uSeriesCatalog(
    [row('SHOW S1 E1'), row('SHOW S1 E2'), row('SHOW S2 E1')],
    'pl-1'
);

describe('M3uSeriesDetailRouteComponent', () => {
    let M3uSeriesDetailRouteComponent: typeof ComponentType;

    beforeAll(async () => {
        ({ M3uSeriesDetailRouteComponent } =
            await import('./m3u-series-detail-route.component'));
    });

    const params = new BehaviorSubject({ get: () => String(CATALOG[0].id) });
    const navigate = jest.fn();

    async function render(): Promise<ComponentFixture<ComponentType>> {
        TestBed.configureTestingModule({
            imports: [M3uSeriesDetailRouteComponent],
            providers: [
                { provide: Router, useValue: { navigate } },
                {
                    provide: ActivatedRoute,
                    useValue: { paramMap: params, snapshot: { data: {} } },
                },
                {
                    provide: Store,
                    useValue: {
                        selectSignal: () => signal({ _id: 'pl-1' }),
                    },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => false,
                        enrichTv: jest.fn(),
                    },
                },
                {
                    provide: M3uCatalogIndexService,
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
        return fixture;
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        params.next({ get: () => String(CATALOG[0].id) });
        navigate.mockReset();
    });

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

    it('returns to the series list from the back action', async () => {
        const fixture = await render();
        const component = fixture.componentInstance as unknown as {
            onBack(): void;
        };

        component.onBack();

        expect(navigate).toHaveBeenCalledWith(
            ['..', 'series'],
            expect.objectContaining({})
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

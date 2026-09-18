import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { FULLSCREEN_CHANNEL_PANEL } from '../fullscreen-channel-panel/fullscreen-channel-panel.model';
import type { PortalInlinePlayerComponent as PortalInlinePlayerComponentInstance } from './portal-inline-player.component';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));

jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

@Component({
    selector: 'app-web-player-view',
    standalone: true,
    template: '<div data-test-id="stub-web-player-view"></div>',
})
class StubWebPlayerViewComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly streamUrl = input.required<string>();
    readonly title = input('');
    readonly mediaTitle = input<unknown>(null);
    readonly playback = input<unknown>(null);
    readonly volume = input(1);
    readonly playerOverride = input<unknown>(null);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly alternativeSources = input<unknown[]>([]);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly externalFallbackRequested = output<unknown>();
    readonly alternativeSourceRequested = output<string>();
    readonly playbackFailed = output<unknown>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

/**
 * The inline player is the series host of the fullscreen side panel: it
 * provides `FULLSCREEN_CHANNEL_PANEL` for the nested view and stamps the
 * episode panel into it, routing a pick through the same output the Up Next
 * rail uses.
 */
describe('PortalInlinePlayerComponent fullscreen episode panel host', () => {
    let PortalInlinePlayerComponent: typeof import('./portal-inline-player.component').PortalInlinePlayerComponent;
    let WebPlayerViewComponent: typeof import('../web-player-view/web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<PortalInlinePlayerComponentInstance>;
    let component: PortalInlinePlayerComponentInstance;
    let panelEnabled: ReturnType<typeof signal<boolean>>;

    beforeAll(async () => {
        ({ PortalInlinePlayerComponent } =
            await import('./portal-inline-player.component'));
        ({ WebPlayerViewComponent } =
            await import('../web-player-view/web-player-view.component'));
    });

    afterEach(() => {
        fixture?.destroy();
    });

    async function setup() {
        panelEnabled = signal(true);
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [PortalInlinePlayerComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: {
                        player: signal('videojs'),
                        playerAmbientMode: signal(false),
                        playerUpNextRail: signal(true),
                        stripCountryPrefix: signal(false),
                        fullscreenChannelPanel: panelEnabled,
                    },
                },
            ],
        })
            .overrideComponent(PortalInlinePlayerComponent, {
                remove: { imports: [WebPlayerViewComponent] },
                add: { imports: [StubWebPlayerViewComponent] },
            })
            .compileComponents();

        fixture = TestBed.createComponent(PortalInlinePlayerComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('playbackSessionKey', 'panel-key');
    }

    const episodePlayback = {
        streamUrl: 'https://example.com/episode.mp4',
        title: 'Episode 2',
        contentInfo: {
            playlistId: 'playlist-1',
            contentXtreamId: 12,
            contentType: 'episode',
        },
    };
    const moviePlayback = {
        streamUrl: 'https://example.com/movie.mp4',
        title: 'Some Movie',
        contentInfo: {
            playlistId: 'playlist-1',
            contentXtreamId: 7,
            contentType: 'movie',
        },
    };
    const seriesEpisodes = {
        '1': [
            { id: '11', season: 1, episode_num: 1, title: 'Pilot', info: [] },
            { id: '12', season: 1, episode_num: 2, title: 'Two', info: [] },
        ],
        '2': [
            { id: '21', season: 2, episode_num: 1, title: 'Three', info: [] },
        ],
    };

    let closeCalls = 0;
    const stampedViews: { destroy: () => void }[] = [];
    afterEach(() => {
        stampedViews.splice(0).forEach((view) => view.destroy());
        closeCalls = 0;
    });

    /** Stamps the host's panel template the way the panel component does. */
    function stampPanel(open = true): HTMLElement {
        const host = fixture.debugElement.injector.get(
            FULLSCREEN_CHANNEL_PANEL
        );
        const template = host.panelTemplate();
        if (!template) {
            throw new Error('panel template is null');
        }
        const view = template.createEmbeddedView({
            searchTerm: signal('').asReadonly(),
            open: signal(open).asReadonly(),
            close: () => closeCalls++,
        });
        stampedViews.push(view);
        view.detectChanges();
        const container = document.createElement('div');
        view.rootNodes.forEach((node: Node) => container.appendChild(node));
        return container;
    }

    it('provides the panel token to the nested view with episode semantics and no search field', async () => {
        await setup();
        fixture.componentRef.setInput('playback', episodePlayback);
        fixture.componentRef.setInput('seriesTitle', 'Some Show');
        fixture.componentRef.setInput('seriesEpisodes', seriesEpisodes);
        fixture.detectChanges();

        const host = fixture.debugElement.injector.get(
            FULLSCREEN_CHANNEL_PANEL
        );
        expect(host).toBe(component);
        expect(host.panelTemplate()).not.toBeNull();
        expect(host.panelTitle?.()).toBe('Some Show');
        expect(host.panelSearchEnabled?.()).toBe(false);
        expect(host.panelKind).toBe('episodes');
    });

    it('builds the seasons for the panel with the playing row, positions and pending seasons', async () => {
        await setup();
        const positions = new Map<number, PlaybackPositionData>([
            [
                11,
                {
                    contentXtreamId: 11,
                    contentType: 'episode',
                    positionSeconds: 95,
                    durationSeconds: 100,
                },
            ],
        ]);
        fixture.componentRef.setInput('playback', episodePlayback);
        fixture.componentRef.setInput('seriesEpisodes', seriesEpisodes);
        fixture.componentRef.setInput('episodePlaybackPositions', positions);
        fixture.componentRef.setInput('pendingSeasonKeys', ['2']);
        fixture.detectChanges();

        const seasons = component.fullscreenEpisodeSeasons();
        expect(seasons.map((season) => season.key)).toEqual(['1', '2']);
        expect(seasons[0].episodes.map((e) => e.isPlaying)).toEqual([
            false,
            true,
        ]);
        expect(seasons[0].episodes[0].watched).toBe(true);
        expect(seasons[1].loaded).toBe(false);
    });

    it('withholds the panel for a movie, without seasons, and when the setting is off', async () => {
        await setup();
        fixture.componentRef.setInput('playback', moviePlayback);
        fixture.componentRef.setInput('seriesEpisodes', seriesEpisodes);
        fixture.detectChanges();
        expect(component.panelTemplate()).toBeNull();

        fixture.componentRef.setInput('playback', episodePlayback);
        fixture.componentRef.setInput('seriesEpisodes', null);
        fixture.detectChanges();
        expect(component.panelTemplate()).toBeNull();

        fixture.componentRef.setInput('seriesEpisodes', seriesEpisodes);
        fixture.detectChanges();
        expect(component.panelTemplate()).not.toBeNull();

        panelEnabled.set(false);
        fixture.detectChanges();
        expect(component.panelTemplate()).toBeNull();
    });

    it('stamps the episode panel and relays a pick through the Up Next output, then closes the panel', async () => {
        await setup();
        const picked: unknown[] = [];
        const seasonsPicked: string[] = [];
        fixture.componentRef.setInput('playback', episodePlayback);
        fixture.componentRef.setInput('seriesEpisodes', seriesEpisodes);
        component.upNextEpisodeSelected.subscribe((item) => picked.push(item));
        component.episodePanelSeasonSelected.subscribe((key) =>
            seasonsPicked.push(key)
        );
        fixture.detectChanges();

        const body = stampPanel();
        const rows = body.querySelectorAll<HTMLButtonElement>(
            '[data-test-id="fullscreen-episode-panel-episode"]'
        );
        expect(rows).toHaveLength(2);
        expect(rows[1].getAttribute('aria-current')).toBe('true');

        rows[0].click();
        expect(picked).toEqual([
            expect.objectContaining({
                id: 11,
                episode: seriesEpisodes['1'][0],
            }),
        ]);
        expect(closeCalls).toBe(1);

        (
            body.querySelectorAll('.season-tabs__pill')[1] as HTMLButtonElement
        ).click();
        expect(seasonsPicked).toEqual(['2']);
    });
});

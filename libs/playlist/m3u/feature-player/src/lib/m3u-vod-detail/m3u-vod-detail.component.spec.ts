import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { Channel, ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import type { M3uVodDetailComponent as M3uVodDetailComponentType } from './m3u-vod-detail.component';

// The component's import chain reaches video.js through the ui/playback
// barrel (PortalInlinePlayerComponent → WebPlayerView → VjsPlayer); the CJS
// bundle breaks under the ESM jest environment, so it is mocked before the
// dynamic import below evaluates the chain.
jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

@Component({
    selector: 'app-portal-detail-shell',
    standalone: true,
    template: '<ng-content />',
})
class StubPortalDetailShellComponent {
    readonly title = input<string>();
    readonly description = input<string>();
    readonly posterUrl = input<string>();
    readonly backdropUrl = input<string>();
    readonly isLoading = input(false);
    readonly errorMessage = input<string>();
    readonly backLabel = input<string>();
    readonly playbackActive = input(false);
    readonly backClicked = output<void>();
    readonly closePlayerRequested = output<void>();
}

@Component({
    selector: 'app-portal-inline-player',
    standalone: true,
    template: '',
})
class StubPortalInlinePlayerComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly playback = input<ResolvedPortalPlayback | null>(null);
    readonly volume = input(1);
    readonly closed = output<void>();
    readonly externalFallbackRequested = output<unknown>();
}

const channel = (overrides: Partial<Channel> = {}): Channel =>
    ({
        id: 'ch1',
        name: 'Dune (2021) 1080p',
        url: 'http://host/movie/user/pass/1.mkv',
        group: { title: 'Movies' },
        tvg: {
            id: '',
            name: '',
            url: '',
            logo: 'http://logo/dune.png',
            rec: '',
        },
        http: { referrer: '', 'user-agent': '', origin: '' },
        radio: '',
        ...overrides,
    }) as Channel;

const playback = (
    overrides: Partial<ResolvedPortalPlayback> = {}
): ResolvedPortalPlayback =>
    ({
        streamUrl: 'http://host/movie/user/pass/1.mkv',
        title: 'Dune (2021) 1080p',
        thumbnail: 'http://logo/dune.png',
        isLive: true,
        ...overrides,
    }) as ResolvedPortalPlayback;

describe('M3uVodDetailComponent', () => {
    let M3uVodDetailComponent: typeof M3uVodDetailComponentType;
    let fixture: ComponentFixture<M3uVodDetailComponentType>;
    let enrichMovie: jest.Mock;

    beforeAll(async () => {
        ({ M3uVodDetailComponent } =
            await import('./m3u-vod-detail.component'));
    });

    const flush = async () => {
        await new Promise<void>((res) => setTimeout(res, 0));
        fixture.detectChanges();
    };

    const create = async (inputs: {
        channel: Channel;
        playback?: ResolvedPortalPlayback | null;
        inlinePlayerAvailable?: boolean;
        volume?: number;
    }) => {
        fixture = TestBed.createComponent(M3uVodDetailComponent);
        fixture.componentRef.setInput('channel', inputs.channel);
        fixture.componentRef.setInput('playback', inputs.playback ?? null);
        fixture.componentRef.setInput('playbackSessionKey', 'live:p1:ch1');
        if (inputs.inlinePlayerAvailable !== undefined) {
            fixture.componentRef.setInput(
                'inlinePlayerAvailable',
                inputs.inlinePlayerAvailable
            );
        }
        if (inputs.volume !== undefined) {
            fixture.componentRef.setInput('volume', inputs.volume);
        }
        fixture.detectChanges();
        await flush();
    };

    const inlinePlayerStub = () =>
        fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        )?.componentInstance as StubPortalInlinePlayerComponent | undefined;

    beforeEach(async () => {
        enrichMovie = jest.fn().mockResolvedValue(null);

        await TestBed.configureTestingModule({
            imports: [M3uVodDetailComponent],
            providers: [
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        enrichMovie,
                        isEnabled: jest.fn().mockReturnValue(true),
                    },
                },
            ],
        })
            // `set` replaces the whole imports list, so the real shell and
            // inline player never need importing here — a static (or even
            // dynamic) barrel import would mark those libs lazy-loaded for
            // the module-boundaries rule workspace-wide.
            .overrideComponent(M3uVodDetailComponent, {
                set: {
                    imports: [
                        StubPortalDetailShellComponent,
                        StubPortalInlinePlayerComponent,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                    ],
                },
            })
            .compileComponents();
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('starts in watch state — activation means play in M3U', async () => {
        await create({ channel: channel(), playback: playback() });

        expect(fixture.componentInstance.playbackActive()).toBe(true);
        expect(
            fixture.nativeElement.querySelector('app-portal-inline-player')
        ).not.toBeNull();
    });

    it('plays with VOD semantics and the parent payload', async () => {
        await create({ channel: channel(), playback: playback() });

        const inline = fixture.componentInstance.inlinePlayback();
        expect(inline?.isLive).toBe(false);
        expect(inline?.streamUrl).toBe('http://host/movie/user/pass/1.mkv');
        expect(inline?.title).toBe('Dune (2021) 1080p');
    });

    it("forwards the host's persisted volume to the player", async () => {
        await create({
            channel: channel(),
            playback: playback(),
            volume: 0.35,
        });

        expect(inlinePlayerStub()?.volume()).toBe(0.35);
    });

    it('keeps the playback payload identical when TMDB metadata lands', async () => {
        // Payload identity is the player's source-application key: a new
        // object recreates the player and restarts the movie. Enrichment must
        // never reach it — only the presentation around it.
        let resolveEnrichment!: (details: unknown) => void;
        enrichMovie.mockReturnValue(
            new Promise((resolve) => {
                resolveEnrichment = resolve;
            })
        );
        await create({ channel: channel(), playback: playback() });

        const before = fixture.componentInstance.inlinePlayback();
        resolveEnrichment({
            id: 42,
            title: 'Dune',
            poster_path: '/p.jpg',
            backdrop_path: '/b.jpg',
        });
        await flush();

        expect(fixture.componentInstance.title()).toBe('Dune');
        expect(fixture.componentInstance.inlinePlayback()).toBe(before);
    });

    it('patches the view when the TMDB match lands', async () => {
        enrichMovie.mockResolvedValue({
            id: 42,
            title: 'Dune',
            overview: 'Spice.',
            poster_path: '/p.jpg',
            backdrop_path: '/b.jpg',
            release_date: '2021-09-15',
            runtime: 155,
            vote_average: 8.04,
            vote_count: 1000,
            genres: [{ id: 1, name: 'Sci-Fi' }],
            credits: {
                cast: [{ name: 'Timothée Chalamet', order: 0 }],
                crew: [{ name: 'Denis Villeneuve', job: 'Director' }],
            },
        });
        await create({ channel: channel(), playback: playback() });

        const component = fixture.componentInstance;
        expect(component.title()).toBe('Dune');
        expect(component.overview()).toBe('Spice.');
        expect(component.posterUrl()).toContain('/p.jpg');
        expect(component.backdropUrl()).toContain('/b.jpg');
        expect(component.year()).toBe('2021');
        expect(component.genres()).toBe('Sci-Fi');
        expect(component.runtimeLabel()).toBe('2h 35m');
        expect(component.rating()).toBe('8.0');
        expect(component.cast().map((member) => member.name)).toEqual([
            'Timothée Chalamet',
        ]);
        expect(component.directors()).toBe('Denis Villeneuve');
    });

    it('keeps the provider presentation when TMDB has no match', async () => {
        enrichMovie.mockResolvedValue(null);
        await create({ channel: channel(), playback: playback() });

        const component = fixture.componentInstance;
        expect(component.title()).toBe('Dune (2021) 1080p');
        expect(component.posterUrl()).toBe('http://logo/dune.png');
        expect(component.backdropUrl()).toBeUndefined();
        expect(component.playbackActive()).toBe(true);
    });

    it('restarts the payload identity when zapping to another movie', async () => {
        await create({ channel: channel(), playback: playback() });
        const first = fixture.componentInstance.inlinePlayback();

        fixture.componentRef.setInput(
            'playback',
            playback({ streamUrl: 'http://host/movie/user/pass/2.mkv' })
        );
        fixture.detectChanges();

        expect(fixture.componentInstance.inlinePlayback()).not.toBe(first);
        expect(fixture.componentInstance.inlinePlayback()?.streamUrl).toBe(
            'http://host/movie/user/pass/2.mkv'
        );
    });

    it('asks the host to refresh volume before remounting the player', async () => {
        await create({ channel: channel(), playback: playback() });
        const started = jest.fn();
        fixture.componentInstance.playbackStarted.subscribe(started);

        fixture.componentInstance.closeInlinePlayback();
        fixture.detectChanges();
        fixture.componentInstance.startPlayback();
        fixture.detectChanges();

        // Browse → Play remounts the engine without a channel change, and the
        // engines only write their own volume to the shared bus.
        expect(started).toHaveBeenCalledTimes(1);
    });

    it('close reveals browse with a Play action; Play re-enters watch', async () => {
        await create({ channel: channel(), playback: playback() });

        fixture.componentInstance.closeInlinePlayback();
        fixture.detectChanges();
        expect(fixture.componentInstance.playbackActive()).toBe(false);
        expect(
            fixture.nativeElement.querySelector('app-portal-inline-player')
        ).toBeNull();
        expect(fixture.componentInstance.canPlayInline()).toBe(true);

        fixture.componentInstance.startPlayback();
        fixture.detectChanges();
        expect(fixture.componentInstance.playbackActive()).toBe(true);
    });

    it('re-enters watch when zapping to the next movie after a close', async () => {
        await create({ channel: channel(), playback: playback() });
        fixture.componentInstance.closeInlinePlayback();
        fixture.detectChanges();

        fixture.componentRef.setInput(
            'channel',
            channel({ id: 'ch2', name: 'Alien' })
        );
        fixture.detectChanges();
        await flush();

        expect(fixture.componentInstance.playbackActive()).toBe(true);
        expect(enrichMovie).toHaveBeenCalledTimes(2);
    });

    it('never mounts an inline player for external MPV/VLC users', async () => {
        await create({
            channel: channel(),
            playback: playback(),
            inlinePlayerAvailable: false,
        });

        expect(fixture.componentInstance.playbackActive()).toBe(false);
        expect(fixture.componentInstance.canPlayInline()).toBe(false);
        expect(
            fixture.nativeElement.querySelector('app-portal-inline-player')
        ).toBeNull();
    });
});

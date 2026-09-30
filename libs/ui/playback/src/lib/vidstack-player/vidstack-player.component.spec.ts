import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import type { Channel } from '@iptvnator/shared/interfaces';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';
import {
    MockHls,
    createFakeHlsProvider,
    createFakeVideoProvider,
} from './vidstack-source-session.spec-fixtures';
import {
    FakeMediaPlayerElement,
    FakeMediaVideoLayoutElement,
    defineFakeVidstackElements,
} from './vidstack-player.component.spec-fixtures';
import type { VidstackPlayerComponent as VidstackPlayerComponentInstance } from './vidstack-player.component';

// The component registers Vidstack's elements through these side-effect
// imports; the fakes stand in for the real runtime.
jest.unstable_mockModule('vidstack/player', () => {
    defineFakeVidstackElements();
    return {};
});
jest.unstable_mockModule('vidstack/player/layouts/default', () => ({}));
jest.unstable_mockModule('vidstack/player/ui', () => ({}));

const LIVE_URL = 'https://example.test/live.m3u8';
const MOVIE_URL = 'https://example.test/movie.mp4';

describe('VidstackPlayerComponent', () => {
    let VidstackPlayerComponent: typeof import('./vidstack-player.component').VidstackPlayerComponent;
    let loadVidstackElements: typeof import('./vidstack-elements').loadVidstackElements;
    let fixture: ComponentFixture<VidstackPlayerComponentInstance>;
    let component: VidstackPlayerComponentInstance;
    let sharedControls: boolean;

    beforeAll(async () => {
        ({ VidstackPlayerComponent } = await import(
            './vidstack-player.component'
        ));
        ({ loadVidstackElements } = await import('./vidstack-elements'));
    });

    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        fixture?.destroy();
    });

    function configure(shared: boolean): void {
        sharedControls = shared;
        TestBed.configureTestingModule({
            imports: [VidstackPlayerComponent, TranslateModule.forRoot()],
            providers: [
                { provide: WEB_PLAYER_SHARED_CONTROLS, useValue: sharedControls },
            ],
        });
    }

    async function createComponent(
        channel: Partial<Channel>,
        inputs: Record<string, unknown> = {}
    ): Promise<void> {
        fixture = TestBed.createComponent(VidstackPlayerComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('channel', channel as Channel);
        for (const [name, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(name, value);
        }
        fixture.detectChanges();
        await mounted();
    }

    /** The player mounts once the (memoized) Vidstack elements resolve. */
    async function mounted(): Promise<void> {
        await loadVidstackElements(!sharedControls);
    }

    function currentPlayer(): FakeMediaPlayerElement {
        const player = (fixture.nativeElement as HTMLElement).querySelector(
            'media-player'
        );
        expect(player).toBeInstanceOf(FakeMediaPlayerElement);
        return player as unknown as FakeMediaPlayerElement;
    }

    describe('with the Vidstack default layout', () => {
        beforeEach(() => configure(false));

        it('builds the player with its layout and app-owned settings', async () => {
            await createComponent(
                { url: LIVE_URL, name: 'News' },
                { volume: 0.4, showCaptions: true }
            );

            const player = currentPlayer();
            expect(player.src).toEqual({
                src: LIVE_URL,
                type: 'application/x-mpegurl',
            });
            expect(player.title).toBe('News');
            // Vidstack reads the HLS stream type from the playlist.
            expect(player.streamType).toBe('unknown');
            expect(player.autoPlay).toBe(true);
            expect(player.playsInline).toBe(true);
            expect(player.load).toBe('eager');
            expect(player.keyDisabled).toBe(true);
            expect(player.querySelector('media-provider')).not.toBeNull();

            const layout = player.querySelector(
                'media-video-layout'
            ) as FakeMediaVideoLayoutElement;
            expect(layout).toBeInstanceOf(FakeMediaVideoLayoutElement);
            expect(layout.menuContainer).toBe(
                fixture.nativeElement.querySelector(
                    '.vidstack-player-container'
                )
            );
            expect(layout.colorScheme).toBe('dark');

            await expect(player.storage?.getVolume()).resolves.toBe(0.4);
            await expect(player.storage?.getMuted()).resolves.toBe(false);
            await expect(player.storage?.getCaptions()).resolves.toBe(true);
            await expect(player.storage?.getTime()).resolves.toBeNull();

            expect(
                fixture.debugElement.query(
                    By.css('app-series-playback-navigation-controls')
                )
            ).not.toBeNull();
            expect(
                fixture.debugElement.query(By.css('app-player-controls'))
            ).toBeNull();
        });

        it('hides the layout until its lazily loaded theme is ready', async () => {
            await createComponent({ url: LIVE_URL, name: 'News' });
            const shell = fixture.nativeElement.querySelector(
                '.vidstack-player-shell'
            ) as HTMLElement;
            expect(shell.classList).toContain(
                'vidstack-player-shell--theme-pending'
            );

            const link = document.head.querySelector(
                'link[data-vidstack-theme]'
            );
            expect(link?.getAttribute('href')).toBe('vidstack-theme.css');
            link?.dispatchEvent(new Event('load'));
            await Promise.resolve();
            fixture.detectChanges();

            expect(shell.classList).not.toContain(
                'vidstack-player-shell--theme-pending'
            );
        });

        it('resumes on-demand media through the Vidstack storage', async () => {
            await createComponent(
                { url: MOVIE_URL, name: 'Movie' },
                { isLive: false, startTime: 42 }
            );

            const player = currentPlayer();
            expect(player.streamType).toBe('on-demand');
            expect(player.src).toEqual({ src: MOVIE_URL, type: 'video/mp4' });
            await expect(player.storage?.getTime()).resolves.toBe(42);
        });

        it('rebuilds the player for a new channel or live answer', async () => {
            await createComponent({ url: LIVE_URL, name: 'News' });
            const first = currentPlayer();

            fixture.componentRef.setInput('channel', {
                url: MOVIE_URL,
                name: 'Movie',
            } as Channel);
            fixture.detectChanges();
            await mounted();
            const second = currentPlayer();

            expect(first.destroy).toHaveBeenCalledTimes(1);
            expect(first.isConnected).toBe(false);
            expect(second).not.toBe(first);
            expect(second.src).toEqual({ src: MOVIE_URL, type: 'video/mp4' });

            fixture.componentRef.setInput('isLive', false);
            fixture.detectChanges();
            await mounted();

            expect(second.destroy).toHaveBeenCalledTimes(1);
            expect(currentPlayer().streamType).toBe('on-demand');
        });

        it('updates the title and volume in place', async () => {
            await createComponent({ url: LIVE_URL, name: 'News' });
            const player = currentPlayer();

            fixture.componentRef.setInput('mediaTitle', {
                primary: 'Show',
                secondary: 'S01E02',
            });
            fixture.componentRef.setInput('volume', 0);
            fixture.detectChanges();

            expect(currentPlayer()).toBe(player);
            expect(player.title).toBe('Show · S01E02');
            expect(player.volume).toBe(0);
            expect(player.muted).toBe(true);
        });

        it('reports media events of the provider video', async () => {
            await createComponent(
                { url: MOVIE_URL, name: 'Movie' },
                { isLive: false }
            );
            const issues: Array<PlaybackDiagnostic | null> = [];
            const updates: PlayerTimeUpdate[] = [];
            component.playbackIssue.subscribe((issue) => issues.push(issue));
            component.timeUpdate.subscribe((update) => updates.push(update));
            const provider = createFakeVideoProvider();

            currentPlayer().announceProvider(provider);
            await provider.loadSource({ src: MOVIE_URL, type: 'video/mp4' });
            provider.video.dispatchEvent(new Event('error'));
            provider.video.dispatchEvent(new Event('timeupdate'));
            provider.video.volume = 0.3;
            provider.video.dispatchEvent(new Event('volumechange'));

            expect(provider.video.getAttribute('src')).toBe(MOVIE_URL);
            expect(issues).toEqual([
                expect.objectContaining({
                    player: 'vidstack',
                    source: 'native',
                    sourceUrl: MOVIE_URL,
                }),
            ]);
            expect(updates).toEqual([
                expect.objectContaining({ currentTime: 0, playing: false }),
            ]);
            expect(localStorage.getItem('volume')).toBe('0.3');
        });

        it('never mounts a player destroyed before Vidstack loaded', async () => {
            fixture = TestBed.createComponent(VidstackPlayerComponent);
            fixture.componentRef.setInput('channel', {
                url: MOVIE_URL,
                name: 'Movie',
            } as Channel);
            fixture.detectChanges();
            const host = fixture.nativeElement as HTMLElement;

            fixture.destroy();
            await mounted();

            expect(host.querySelector('media-player')).toBeNull();
        });

        it('destroys the player and ignores late providers on destroy', async () => {
            await createComponent({ url: MOVIE_URL, name: 'Movie' });
            const player = currentPlayer();
            const provider = createFakeVideoProvider();

            fixture.destroy();
            player.announceProvider(provider);

            expect(player.destroy).toHaveBeenCalledTimes(1);
            expect(player.isConnected).toBe(false);
            expect(provider.loadSource).toBe(provider.vendorLoadSource);
        });
    });

    describe('with shared controls', () => {
        beforeEach(() => configure(true));

        it('mounts the shared controls over a layout-free player', async () => {
            await createComponent({ url: LIVE_URL, name: 'News' });
            const attach = jest.spyOn(component.controlsAdapter, 'attach');
            const player = currentPlayer();
            const provider = createFakeHlsProvider();

            player.announceProvider(provider);
            provider.createInstance();

            expect(player.querySelector('media-video-layout')).toBeNull();
            expect(
                fixture.debugElement.queryAll(By.css('app-player-controls'))
            ).toHaveLength(1);
            expect(
                fixture.debugElement.query(
                    By.css('app-series-playback-navigation-controls')
                )
            ).toBeNull();
            expect(
                fixture.nativeElement.querySelector(
                    '.vidstack-player-shell--theme-pending'
                )
            ).toBeNull();
            expect(provider.library).toBe(MockHls);
            expect(attach).toHaveBeenCalledWith(
                provider.video,
                expect.objectContaining({ isLive: expect.any(Function) })
            );
        });

        it('exits the owned fullscreen when diagnostics take over', async () => {
            const target = document.createElement('div');
            const exitFullscreen = jest.fn(() => Promise.resolve());
            const originalExit = document.exitFullscreen;
            Object.defineProperty(document, 'fullscreenElement', {
                configurable: true,
                get: () => target,
            });
            document.exitFullscreen = exitFullscreen;
            try {
                await createComponent(
                    { url: LIVE_URL, name: 'News' },
                    { fullscreenTarget: target }
                );

                fixture.componentRef.setInput('interactionEnabled', false);
                fixture.detectChanges();

                expect(exitFullscreen).toHaveBeenCalledTimes(1);
            } finally {
                delete (document as { fullscreenElement?: unknown })
                    .fullscreenElement;
                document.exitFullscreen = originalExit;
            }
        });
    });
});

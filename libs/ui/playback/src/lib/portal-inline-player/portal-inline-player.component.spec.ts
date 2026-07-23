import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
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
    readonly streamUrl = input.required<string>();
    readonly title = input('');
    readonly playback = input<unknown>(null);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly externalFallbackRequested = output<unknown>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

describe('PortalInlinePlayerComponent', () => {
    let PortalInlinePlayerComponent: typeof import('./portal-inline-player.component').PortalInlinePlayerComponent;
    let WebPlayerViewComponent: typeof import('../web-player-view/web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<PortalInlinePlayerComponentInstance>;
    let component: PortalInlinePlayerComponentInstance;

    beforeAll(async () => {
        ({ PortalInlinePlayerComponent } = await import(
            './portal-inline-player.component'
        ));
        ({ WebPlayerViewComponent } = await import(
            '../web-player-view/web-player-view.component'
        ));
    });

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PortalInlinePlayerComponent, TranslateModule.forRoot()],
        })
            .overrideComponent(PortalInlinePlayerComponent, {
                remove: {
                    imports: [WebPlayerViewComponent],
                },
                add: {
                    imports: [StubWebPlayerViewComponent],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(PortalInlinePlayerComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('renders episode metadata below the title and forwards embedded MPV navigation events', () => {
        const events: string[] = [];
        const seriesNavigation = {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        };
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.test/series/1002.mp4',
            title: 'Episode 2',
            startTime: 12,
        });
        fixture.componentRef.setInput('episodeMetadata', {
            label: 'S01E02',
            title: 'Episode 2',
            seasonNumber: 1,
            episodeNumber: 2,
        });
        fixture.componentRef.setInput('seriesNavigation', seriesNavigation);
        (
            component as unknown as {
                playbackEnded: { subscribe: (fn: () => void) => void };
                previousEpisodeRequested: { subscribe: (fn: () => void) => void };
                nextEpisodeRequested: { subscribe: (fn: () => void) => void };
            }
        ).playbackEnded.subscribe(() => events.push('ended'));
        (
            component as unknown as {
                previousEpisodeRequested: { subscribe: (fn: () => void) => void };
            }
        ).previousEpisodeRequested.subscribe(() => events.push('previous'));
        (
            component as unknown as {
                nextEpisodeRequested: { subscribe: (fn: () => void) => void };
            }
        ).nextEpisodeRequested.subscribe(() => events.push('next'));

        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'S01E02 - Episode 2'
        );

        const webPlayer = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        ).componentInstance as StubWebPlayerViewComponent;
        expect(webPlayer.seriesNavigation()).toBe(seriesNavigation);

        webPlayer.playbackEnded.emit();
        webPlayer.previousEpisodeRequested.emit();
        webPlayer.nextEpisodeRequested.emit();

        expect(events).toEqual(['ended', 'previous', 'next']);
    });

    it('emits backClicked (not closed) from the back button in the now-playing bar', () => {
        let backCount = 0;
        let closedCount = 0;
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.test/vod/1.mp4',
            title: 'Movie',
        });
        (
            component as unknown as {
                backClicked: { subscribe: (fn: () => void) => void };
            }
        ).backClicked.subscribe(() => backCount++);
        (
            component as unknown as {
                closed: { subscribe: (fn: () => void) => void };
            }
        ).closed.subscribe(() => closedCount++);

        fixture.detectChanges();

        const backButton = fixture.nativeElement.querySelector(
            '[data-testid="inline-player-back"]'
        ) as HTMLButtonElement;
        expect(backButton).toBeTruthy();
        backButton.click();
        expect(backCount).toBe(1);
        expect(closedCount).toBe(0);
    });

    describe('with strip country prefix enabled', () => {
        beforeEach(async () => {
            TestBed.resetTestingModule();
            await TestBed.configureTestingModule({
                imports: [
                    PortalInlinePlayerComponent,
                    TranslateModule.forRoot(),
                ],
                providers: [
                    {
                        provide: SettingsStore,
                        useValue: { stripCountryPrefix: signal(true) },
                    },
                ],
            })
                .overrideComponent(PortalInlinePlayerComponent, {
                    remove: {
                        imports: [WebPlayerViewComponent],
                    },
                    add: {
                        imports: [StubWebPlayerViewComponent],
                    },
                })
                .compileComponents();

            fixture = TestBed.createComponent(PortalInlinePlayerComponent);
            component = fixture.componentInstance;
        });

        it('strips the prefix from live playback titles', () => {
            fixture.componentRef.setInput('playback', {
                streamUrl: 'https://example.com/live.m3u8',
                title: 'US | CNN',
                isLive: true,
            });
            fixture.detectChanges();

            expect(component.title()).toBe('CNN');
        });

        it('keeps VOD titles untouched', () => {
            fixture.componentRef.setInput('playback', {
                streamUrl: 'https://example.com/movie.mp4',
                title: 'US | Some Movie',
            });
            fixture.detectChanges();

            expect(component.title()).toBe('US | Some Movie');
        });
    });

    describe('ambient background fill', () => {
        async function setup(
            ambientEnabled: boolean,
            player = 'videojs'
        ): Promise<void> {
            TestBed.resetTestingModule();
            await TestBed.configureTestingModule({
                imports: [
                    PortalInlinePlayerComponent,
                    TranslateModule.forRoot(),
                ],
                providers: [
                    {
                        provide: SettingsStore,
                        useValue: {
                            player: signal(player),
                            playerAmbientMode: signal(ambientEnabled),
                            stripCountryPrefix: signal(false),
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
        }

        const ambientEl = () =>
            fixture.nativeElement.querySelector('.player-shell__ambient');

        it('renders a poster-backed ambient layer for VOD when enabled', async () => {
            await setup(true);
            fixture.componentRef.setInput('playback', {
                streamUrl: 'https://example.com/movie.mp4',
                title: 'Some Movie',
                thumbnail: 'https://cdn.example.com/poster.jpg',
            });
            fixture.detectChanges();

            const layer = ambientEl() as HTMLElement | null;
            expect(component.ambientEnabled()).toBe(true);
            expect(layer).toBeTruthy();
            expect(layer?.style.getPropertyValue('--ambient-image')).toBe(
                'url("https://cdn.example.com/poster.jpg")'
            );
        });

        it('does not render the ambient layer when the setting is off', async () => {
            await setup(false);
            fixture.componentRef.setInput('playback', {
                streamUrl: 'https://example.com/movie.mp4',
                title: 'Some Movie',
                thumbnail: 'https://cdn.example.com/poster.jpg',
            });
            fixture.detectChanges();

            expect(component.ambientEnabled()).toBe(false);
            expect(ambientEl()).toBeNull();
        });

        it('skips the ambient layer for live channels and without a poster', async () => {
            await setup(true);
            fixture.componentRef.setInput('playback', {
                streamUrl: 'https://example.com/live.m3u8',
                title: 'CNN',
                thumbnail: 'https://cdn.example.com/logo.png',
                isLive: true,
            });
            fixture.detectChanges();
            expect(ambientEl()).toBeNull();

            fixture.componentRef.setInput('playback', {
                streamUrl: 'https://example.com/movie.mp4',
                title: 'No Poster Movie',
            });
            fixture.detectChanges();
            expect(ambientEl()).toBeNull();
        });

        it('keeps the ambient layer off for non-web engines like embedded MPV', async () => {
            await setup(true, 'embedded-mpv');
            fixture.componentRef.setInput('playback', {
                streamUrl: 'https://example.com/movie.mp4',
                title: 'Some Movie',
                thumbnail: 'https://cdn.example.com/poster.jpg',
            });
            fixture.detectChanges();

            expect(component.ambientEnabled()).toBe(false);
            expect(ambientEl()).toBeNull();
        });

        it('rejects non-http(s) poster URLs to avoid CSS breakout', async () => {
            await setup(true);
            fixture.componentRef.setInput('playback', {
                streamUrl: 'https://example.com/movie.mp4',
                title: 'Sneaky',
                thumbnail: 'javascript:alert(1)',
            });
            fixture.detectChanges();

            expect(component.ambientImageStyle()).toBeNull();
            expect(ambientEl()).toBeNull();
        });
    });
});

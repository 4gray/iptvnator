import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import type { Channel } from '@iptvnator/shared/interfaces';
import {
    PlayerControlsComponent,
    WEB_PLAYER_SHARED_CONTROLS,
} from '../player-controls';
import type { ArtPlayerComponent as ArtPlayerComponentInstance } from './art-player.component';

const artPlayerInstances: MockArtplayer[] = [];

class MockArtplayer {
    static AUTO_PLAYBACK_TIMEOUT = 0;

    readonly video = document.createElement('video');
    readonly setting = { add: jest.fn() };
    readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    readonly on = jest.fn(
        (event: string, handler: (...args: unknown[]) => void) => {
            const handlers = this.handlers.get(event) ?? [];
            handlers.push(handler);
            this.handlers.set(event, handlers);
            return this;
        }
    );
    readonly off = jest.fn(
        (event: string, handler: (...args: unknown[]) => void) => {
            const handlers = this.handlers.get(event) ?? [];
            this.handlers.set(
                event,
                handlers.filter((candidate) => candidate !== handler)
            );
            return this;
        }
    );
    readonly destroy = jest.fn();
    currentTime = 0;
    duration = 0;
    seek = 0;

    constructor(readonly options: Record<string, unknown>) {
        this.video.volume = Number(options['volume'] ?? 1);
        const stored = JSON.parse(
            localStorage.getItem('artplayer_settings') ?? '{}'
        ) as { volume?: unknown };
        if (typeof stored.volume === 'number') {
            this.video.volume = stored.volume;
        }
        artPlayerInstances.push(this);
    }

    get volume(): number {
        return this.video.volume;
    }

    set volume(value: number) {
        this.video.volume = value;
    }
}

class MockHls {
    static Events = {
        MANIFEST_PARSED: 'manifestParsed',
        ERROR: 'error',
        AUDIO_TRACKS_UPDATED: 'audioTracksUpdated',
        AUDIO_TRACK_SWITCHING: 'audioTrackSwitching',
        AUDIO_TRACK_SWITCHED: 'audioTrackSwitched',
        SUBTITLE_TRACKS_UPDATED: 'subtitleTracksUpdated',
        SUBTITLE_TRACKS_CLEARED: 'subtitleTracksCleared',
        SUBTITLE_TRACK_SWITCH: 'subtitleTrackSwitch',
        MANIFEST_LOADING: 'manifestLoading',
    };
    static isSupported = jest.fn(() => true);
}

jest.unstable_mockModule('artplayer', () => ({
    default: MockArtplayer,
}));

jest.unstable_mockModule('hls.js', () => ({
    default: MockHls,
}));

jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: { ERROR: 'error' },
        createPlayer: jest.fn(),
        isSupported: jest.fn(() => true),
    },
}));

describe('ArtPlayerComponent with shared controls', () => {
    let ArtPlayerComponent: typeof import('./art-player.component').ArtPlayerComponent;
    let fixture: ComponentFixture<ArtPlayerComponentInstance>;
    let component: ArtPlayerComponentInstance;

    beforeAll(async () => {
        ({ ArtPlayerComponent } = await import('./art-player.component'));
    });

    beforeEach(() => {
        artPlayerInstances.length = 0;
        localStorage.clear();

        TestBed.configureTestingModule({
            imports: [ArtPlayerComponent, TranslateModule.forRoot()],
            providers: [
                { provide: WEB_PLAYER_SHARED_CONTROLS, useValue: true },
            ],
        });
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('renders exactly one shared controls surface and disables vendor interaction owners', () => {
        createComponent({
            url: 'https://example.test/movie.mp4',
            name: 'Movie',
        });

        const options = artPlayerInstances[0].options;
        expect(options).toEqual(
            expect.objectContaining({
                controls: [],
                autoPlayback: false,
                autoSize: false,
                autoMini: false,
                setting: false,
                fullscreen: false,
                fullscreenWeb: false,
                hotkey: false,
                fastForward: false,
                autoOrientation: false,
            })
        );
        expect(
            fixture.debugElement.queryAll(By.css('app-player-controls'))
        ).toHaveLength(1);
        expect(
            fixture.debugElement.query(
                By.css('.art-player-interaction-capture')
            )
        ).not.toBeNull();
        expect(
            fixture.debugElement.query(
                By.css('app-series-playback-navigation-controls')
            )
        ).toBeNull();
        expect(
            fixture.debugElement
                .query(By.css('.art-player-shell'))
                .nativeElement.classList.contains(
                    'art-player-shell--shared-controls'
                )
        ).toBe(true);
    });

    it('reapplies the app volume after ArtPlayer restores vendor storage', () => {
        localStorage.setItem(
            'artplayer_settings',
            JSON.stringify({ volume: 0.2 })
        );

        createComponent(
            {
                url: 'https://example.test/movie.mp4',
                name: 'Movie',
            },
            { volume: 0.8 }
        );

        expect(artPlayerInstances[0].video.volume).toBe(0.8);
    });

    it('keeps the vendor event capture active while diagnostics disable shared interaction', () => {
        createComponent({
            url: 'https://example.test/movie.mp4',
            name: 'Movie',
        });

        fixture.componentRef.setInput('interactionEnabled', false);
        fixture.detectChanges();

        const controls = fixture.debugElement.query(
            By.directive(PlayerControlsComponent)
        ).componentInstance as PlayerControlsComponent;
        expect(controls.showControls()).toBe(false);
        expect(controls.shortcutsEnabled()).toBe(false);
        expect(
            fixture.debugElement.query(
                By.css('.art-player-interaction-capture')
            )
        ).not.toBeNull();
    });

    it('updates shared series navigation without recreating the player', () => {
        createComponent(
            {
                url: 'https://example.test/series/episode.mp4',
                name: 'Episode',
            },
            { isLive: false }
        );

        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        fixture.detectChanges();

        expect(component.controlsAdapter.capabilities().seriesNavigation).toBe(
            true
        );
        expect(component.controlsAdapter.state()).toEqual(
            expect.objectContaining({
                canPreviousEpisode: true,
                canNextEpisode: false,
            })
        );
        expect(artPlayerInstances).toHaveLength(1);
    });

    it('restarts the shared ArtPlayer session when authoritative live metadata changes', () => {
        createComponent(
            {
                url: 'https://example.test/movie.ts',
                name: 'Movie',
            },
            { isLive: true }
        );

        fixture.componentRef.setInput('isLive', false);
        fixture.detectChanges();

        expect(artPlayerInstances).toHaveLength(2);
        expect(artPlayerInstances[1].options['isLive']).toBe(false);
        expect(artPlayerInstances[0].destroy).toHaveBeenCalledTimes(1);
    });

    it('exits only the ArtPlayer shell fullscreen when interaction is disabled', () => {
        const fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'fullscreenElement'
        );
        const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'exitFullscreen'
        );
        let fullscreenElement: Element | null = null;
        const exitFullscreen = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement,
        });
        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: exitFullscreen,
        });

        try {
            createComponent({
                url: 'https://example.test/movie.mp4',
                name: 'Movie',
            });
            fullscreenElement = fixture.debugElement.query(
                By.css('.art-player-shell')
            ).nativeElement;

            fixture.componentRef.setInput('interactionEnabled', false);
            fixture.detectChanges();

            expect(exitFullscreen).toHaveBeenCalledTimes(1);
        } finally {
            restoreDocumentProperty(
                'fullscreenElement',
                fullscreenElementDescriptor
            );
            restoreDocumentProperty('exitFullscreen', exitFullscreenDescriptor);
        }
    });

    function createComponent(
        channel: Pick<Channel, 'url' | 'name'>,
        inputs: { volume?: number; isLive?: boolean } = {}
    ): void {
        fixture = TestBed.createComponent(ArtPlayerComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('channel', channel);
        fixture.componentRef.setInput('volume', inputs.volume ?? 1);
        fixture.componentRef.setInput('isLive', inputs.isLive ?? true);
        fixture.detectChanges();
    }
});

function restoreDocumentProperty(
    property: 'exitFullscreen' | 'fullscreenElement',
    descriptor: PropertyDescriptor | undefined
): void {
    if (descriptor) {
        Object.defineProperty(document, property, descriptor);
        return;
    }

    delete (document as unknown as Record<string, unknown>)[property];
}

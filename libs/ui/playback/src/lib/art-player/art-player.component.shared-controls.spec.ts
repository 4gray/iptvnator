import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Channel } from '@iptvnator/shared/interfaces';
import { TranslateModule } from '@ngx-translate/core';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls';
import type { ArtPlayerComponent as ArtPlayerComponentInstance } from './art-player.component';

const artPlayerInstances: MockArtplayer[] = [];

class MockArtplayer {
    static AUTO_PLAYBACK_TIMEOUT = 0;

    readonly video = document.createElement('video');
    readonly setting = { add: jest.fn() };
    readonly on = jest.fn();
    readonly destroy = jest.fn();
    readonly currentTime = 0;
    readonly duration = 0;
    volume: number;

    constructor(readonly options: Record<string, unknown>) {
        this.volume = Number(options['volume'] ?? 1);
        artPlayerInstances.push(this);
    }
}

class MockHls {
    static Events = {
        MANIFEST_PARSED: 'manifestParsed',
        ERROR: 'error',
        AUDIO_TRACKS_UPDATED: 'audioTracksUpdated',
    };

    static isSupported = jest.fn(() => true);

    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    readonly on = jest.fn(
        (event: string, handler: (...args: unknown[]) => void) => {
            this.handlers.set(event, handler);
        }
    );
    readonly loadSource = jest.fn();
    readonly attachMedia = jest.fn();
    readonly destroy = jest.fn();
    readonly audioTracks: unknown[] = [];
}

jest.unstable_mockModule('artplayer', () => ({
    default: MockArtplayer,
}));

jest.unstable_mockModule('hls.js', () => ({
    default: MockHls,
}));

jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: {
            ERROR: 'error',
        },
        createPlayer: jest.fn(),
        isSupported: jest.fn(() => true),
    },
}));

describe('ArtPlayerComponent with shared controls flag ON', () => {
    let ArtPlayerComponent: typeof import('./art-player.component').ArtPlayerComponent;
    let fixture: ComponentFixture<ArtPlayerComponentInstance>;
    let component: ArtPlayerComponentInstance;

    beforeAll(async () => {
        ({ ArtPlayerComponent } = await import('./art-player.component'));
    });

    beforeEach(() => {
        artPlayerInstances.length = 0;

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

    function createComponent(channel: Pick<Channel, 'url' | 'name'>): void {
        fixture = TestBed.createComponent(ArtPlayerComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('channel', channel);
        fixture.detectChanges();
    }

    it('disables the ArtPlayer skin and renders shared controls', () => {
        createComponent({
            url: 'https://example.com/movie.mp4',
            name: 'Movie',
        });

        expect(component.sharedControls).toBe(true);
        expect(artPlayerInstances[0].options['setting']).toBe(false);
        expect(artPlayerInstances[0].options['fullscreen']).toBe(false);
        expect(artPlayerInstances[0].options['controls']).toEqual([]);
        // autoSize would shrink the player to the video aspect and leave
        // black margins the overlay spans — disabled for the shared layout.
        expect(artPlayerInstances[0].options['autoSize']).toBe(false);
        expect(
            fixture.debugElement.query(By.css('app-player-controls'))
        ).not.toBeNull();
        // Drives the SCSS that isolates ArtPlayer's stacking context and
        // hides its leftover chrome so the overlay is the only UI on top.
        expect(
            fixture.debugElement
                .query(By.css('.art-player-shell'))
                .nativeElement.classList.contains(
                    'art-player-shell--shared-controls'
                )
        ).toBe(true);
    });
});

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import {
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { HIDDEN_BOUNDS } from './embedded-mpv-format.utils';
import { EmbeddedMpvOverlayVisibilityService } from './embedded-mpv-overlay-visibility.service';
import { EmbeddedMpvPlayerComponent } from './embedded-mpv-player.component';
import {
    EmbeddedMpvBoundsProvider,
    EmbeddedMpvSessionController,
} from './embedded-mpv-session-controller';

@Component({
    imports: [EmbeddedMpvPlayerComponent],
    template: `<app-embedded-mpv-player [playback]="playback" />`,
})
class DockPanelsHostComponent {
    playback: ResolvedPortalPlayback = {
        streamUrl: 'https://example.test/movie/42.mp4',
        title: 'Movie',
        contentInfo: {
            playlistId: 'playlist-1',
            contentXtreamId: 42,
            contentType: 'movie',
        },
    };
}

const HOST_RECT = { left: 4, top: 8, width: 1280, height: 720 };
const FULL_BOUNDS = { x: 4, y: 8, width: 1280, height: 720 };
const HOST_STUB = {
    getBoundingClientRect: () => HOST_RECT,
} as unknown as HTMLElement;

describe('EmbeddedMpvPlayerComponent dock panels', () => {
    let fixture: ComponentFixture<DockPanelsHostComponent>;
    let player: EmbeddedMpvPlayerComponent;
    let controller: EmbeddedMpvSessionController;
    let boundsProviderSpy: jest.SpyInstance;
    const overlayActive = signal(false);

    const boundsProvider = (): EmbeddedMpvBoundsProvider =>
        boundsProviderSpy.mock.calls[0][0];

    const query = (selector: string) =>
        fixture.debugElement.query(By.css(selector));
    const queryAll = (selector: string) =>
        fixture.debugElement.queryAll(By.css(selector));

    const configureReadyController = () => {
        controller.support.set({
            supported: true,
            platform: 'darwin',
            engine: 'native',
            capabilities: {
                subtitles: true,
                playbackSpeed: true,
                aspectOverride: true,
                screenshot: false,
                recording: false,
            },
        });
        controller.session.set({
            id: 'session-1',
            title: 'Movie',
            streamUrl: 'https://example.test/movie/42.mp4',
            status: 'playing',
            positionSeconds: 30,
            durationSeconds: 120,
            volume: 1,
            audioTracks: [
                {
                    id: 1,
                    language: 'eng',
                    selected: true,
                    defaultTrack: true,
                },
                { id: 2, language: 'deu', selected: false },
            ],
            selectedAudioTrackId: 1,
            subtitleTracks: [
                { id: 21, language: 'eng', selected: false },
                { id: 22, language: 'deu', selected: false },
            ],
            selectedSubtitleTrackId: null,
            playbackSpeed: 1,
            aspectOverride: 'no',
            recording: { active: false },
            startedAt: '2026-07-19T12:00:00Z',
            updatedAt: '2026-07-19T12:00:00Z',
        } satisfies EmbeddedMpvSession);
        fixture.detectChanges();
    };

    beforeEach(async () => {
        overlayActive.set(false);
        boundsProviderSpy = jest.spyOn(
            EmbeddedMpvSessionController.prototype,
            'setBoundsProvider'
        );

        await TestBed.configureTestingModule({
            imports: [DockPanelsHostComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: EmbeddedMpvOverlayVisibilityService,
                    useValue: { overlayActive },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(DockPanelsHostComponent);
        fixture.detectChanges();
        const playerDebugElement = fixture.debugElement.query(
            By.directive(EmbeddedMpvPlayerComponent)
        );
        player = playerDebugElement.componentInstance;
        controller = playerDebugElement.injector.get(
            EmbeddedMpvSessionController
        );
        configureReadyController();
    });

    afterEach(() => {
        fixture.destroy();
        boundsProviderSpy.mockRestore();
    });

    it('keeps full host bounds while every control menu is open', () => {
        const provider = boundsProvider();

        expect(provider(HOST_STUB)).toEqual(FULL_BOUNDS);

        for (const menu of [
            'volume',
            'audio',
            'subtitle',
            'speed',
            'aspect',
        ] as const) {
            player.menus.open(menu);
            // Core regression: menus render inside the fixed dock strip, so
            // the native MPV view must never shrink (no bottom cutout).
            expect(provider(HOST_STUB)).toEqual(FULL_BOUNDS);
        }
    });

    it('still hides the native view while a modal overlay is active', () => {
        overlayActive.set(true);
        expect(boundsProvider()(HOST_STUB)).toEqual(HIDDEN_BOUNDS);

        overlayActive.set(false);
        expect(boundsProvider()(HOST_STUB)).toEqual(FULL_BOUNDS);
    });

    it('morphs the dock row into a horizontal audio panel with menu roles', () => {
        query('[data-embedded-mpv-menu-button="audio"]').nativeElement.click();
        fixture.detectChanges();

        expect(query('.embedded-mpv-player__transport')).toBeNull();
        expect(query('app-embedded-mpv-dock-panel')).not.toBeNull();

        const ribbon = query('.embedded-mpv-dock-panel__ribbon');
        expect(ribbon.attributes['role']).toBe('menu');
        expect(ribbon.attributes['aria-orientation']).toBe('horizontal');

        const chips = queryAll('.embedded-mpv-dock-panel__chip');
        expect(chips).toHaveLength(2);
        expect(chips[0].attributes['role']).toBe('menuitemradio');
        expect(chips[0].nativeElement.getAttribute('aria-checked')).toBe(
            'true'
        );
        expect(chips[0].nativeElement.tabIndex).toBe(0);
        expect(chips[1].nativeElement.getAttribute('aria-checked')).toBe(
            'false'
        );
        expect(chips[1].nativeElement.tabIndex).toBe(-1);
        expect(chips[1].nativeElement.getAttribute('title')).toContain('deu');
    });

    it('selects an audio chip, closes the panel, and restores the row', async () => {
        const setAudioTrack = jest
            .spyOn(controller, 'setAudioTrack')
            .mockResolvedValue(undefined);

        query('[data-embedded-mpv-menu-button="audio"]').nativeElement.click();
        fixture.detectChanges();
        queryAll('.embedded-mpv-dock-panel__chip')[1].nativeElement.click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(setAudioTrack).toHaveBeenCalledWith(2);
        expect(player.menus.audioOpen()).toBe(false);
        expect(query('app-embedded-mpv-dock-panel')).toBeNull();
        expect(query('.embedded-mpv-player__transport')).not.toBeNull();
    });

    it('renders the subtitles-off chip first and maps it to track -1', async () => {
        const setSubtitleTrack = jest
            .spyOn(controller, 'setSubtitleTrack')
            .mockResolvedValue(undefined);

        query(
            '[data-embedded-mpv-menu-button="subtitle"]'
        ).nativeElement.click();
        fixture.detectChanges();

        const chips = queryAll('.embedded-mpv-dock-panel__chip');
        expect(chips).toHaveLength(3);
        expect(chips[0].nativeElement.getAttribute('aria-checked')).toBe(
            'true'
        );

        chips[0].nativeElement.click();
        await fixture.whenStable();
        expect(setSubtitleTrack).toHaveBeenCalledWith(-1);

        query(
            '[data-embedded-mpv-menu-button="subtitle"]'
        ).nativeElement.click();
        fixture.detectChanges();
        queryAll('.embedded-mpv-dock-panel__chip')[2].nativeElement.click();
        await fixture.whenStable();
        expect(setSubtitleTrack).toHaveBeenCalledWith(22);
    });

    it('selects speed and aspect presets from horizontal chip rows', async () => {
        const setSpeed = jest
            .spyOn(controller, 'setSpeed')
            .mockResolvedValue(undefined);
        const setAspect = jest
            .spyOn(controller, 'setAspect')
            .mockResolvedValue(undefined);

        query('[data-embedded-mpv-menu-button="speed"]').nativeElement.click();
        fixture.detectChanges();
        expect(queryAll('.embedded-mpv-dock-panel__chip')).toHaveLength(6);
        queryAll('.embedded-mpv-dock-panel__chip')[4].nativeElement.click();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(setSpeed).toHaveBeenCalledWith(1.5);

        query('[data-embedded-mpv-menu-button="aspect"]').nativeElement.click();
        fixture.detectChanges();
        expect(queryAll('.embedded-mpv-dock-panel__chip')).toHaveLength(5);
        queryAll('.embedded-mpv-dock-panel__chip')[1].nativeElement.click();
        await fixture.whenStable();
        expect(setAspect).toHaveBeenCalledWith('16:9');
    });

    it('expands volume inline without morphing the row', () => {
        player.menus.open('volume');
        fixture.detectChanges();

        expect(query('.embedded-mpv-player__volume-inline')).not.toBeNull();
        expect(query('.embedded-mpv-player__transport')).not.toBeNull();
        expect(query('app-embedded-mpv-dock-panel')).toBeNull();

        const slider = query('.embedded-mpv-player__slider--volume')
            .nativeElement as HTMLInputElement;
        slider.value = '0.4';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        fixture.detectChanges();

        expect(player.volume()).toBe(0.4);
    });

    it('closes an open panel with Escape', () => {
        query('[data-embedded-mpv-menu-button="speed"]').nativeElement.click();
        fixture.detectChanges();
        expect(player.menus.speedOpen()).toBe(true);

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        fixture.detectChanges();

        expect(player.menus.anyOpen()).toBe(false);
        expect(query('.embedded-mpv-player__transport')).not.toBeNull();
    });

    it('blocks seek and volume arrow shortcuts while a chip panel is open', () => {
        const seekBy = jest
            .spyOn(controller, 'seekBy')
            .mockResolvedValue(true);
        const volumeBefore = player.volume();

        query('[data-embedded-mpv-menu-button="audio"]').nativeElement.click();
        fixture.detectChanges();

        for (const key of [
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
        ]) {
            document.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key,
                    bubbles: true,
                    cancelable: true,
                })
            );
        }

        expect(seekBy).not.toHaveBeenCalled();
        expect(player.volume()).toBe(volumeBefore);

        player.menus.closeAll();
        fixture.detectChanges();
        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'ArrowRight',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(seekBy).toHaveBeenCalledWith(5);
    });
});

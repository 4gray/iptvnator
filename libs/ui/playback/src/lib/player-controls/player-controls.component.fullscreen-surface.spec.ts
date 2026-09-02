import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import { PlayerControlsComponent } from './player-controls.component';
import type {
    PlayerControlsCapabilities,
    PlayerControlsCommands,
    PlayerControlsState,
    PlayerController,
} from './player-controls.model';
import { PLAYER_FULLSCREEN_SURFACE } from './player-fullscreen-surface';

function createFakeController(): PlayerController {
    const capabilities: WritableSignal<PlayerControlsCapabilities> = signal({
        ...DEFAULT_PLAYER_CAPABILITIES,
        fullscreen: true,
    });
    const state: WritableSignal<PlayerControlsState> = signal(
        createEmptyControlsState()
    );
    const commands: jest.Mocked<PlayerControlsCommands> = {
        togglePlay: jest.fn(),
        seekTo: jest.fn(),
        seekBy: jest.fn(),
        setVolume: jest.fn(),
        setAudioTrack: jest.fn(),
        setSubtitleTrack: jest.fn(),
        addExternalSubtitleFile: jest.fn(),
        setSubtitleDelay: jest.fn(),
        setSubtitleStyle: jest.fn(),
        setQualityLevel: jest.fn(),
        setPlaybackSpeed: jest.fn(),
        setAspectRatio: jest.fn(),
        toggleRecording: jest.fn(),
        togglePictureInPicture: jest.fn(),
    };
    return { capabilities, state, commands };
}

describe('PlayerControlsComponent fullscreen surface', () => {
    let fixture: ComponentFixture<PlayerControlsComponent>;
    let component: PlayerControlsComponent;
    let engineSurface: HTMLElement;
    let viewHost: HTMLElement;
    let fullscreenElement: Element | null;
    let requestFullscreen: jest.Mock;
    let exitFullscreen: jest.Mock;

    beforeEach(async () => {
        localStorage.removeItem('volume');
        viewHost = document.createElement('div');
        engineSurface = document.createElement('div');
        viewHost.appendChild(engineSurface);
        document.body.appendChild(viewHost);

        fullscreenElement = null;
        requestFullscreen = jest.fn(() => {
            fullscreenElement = viewHost;
            document.dispatchEvent(new Event('fullscreenchange'));
            return Promise.resolve();
        });
        exitFullscreen = jest.fn(() => {
            fullscreenElement = null;
            document.dispatchEvent(new Event('fullscreenchange'));
            return Promise.resolve();
        });
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement,
        });
        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: exitFullscreen,
        });
        viewHost.requestFullscreen = requestFullscreen;
        engineSurface.requestFullscreen = jest.fn(() => Promise.resolve());

        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: PLAYER_FULLSCREEN_SURFACE,
                    useValue: { element: () => viewHost },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(PlayerControlsComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('controller', createFakeController());
        fixture.componentRef.setInput('playerSurface', engineSurface);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        viewHost.remove();
    });

    it('sends the provided view host to fullscreen instead of the engine surface', async () => {
        await component.toggleFullscreen();
        fixture.detectChanges();

        expect(requestFullscreen).toHaveBeenCalledTimes(1);
        expect(engineSurface.requestFullscreen).not.toHaveBeenCalled();
        expect(component.isFullscreen()).toBe(true);

        await component.toggleFullscreen();
        fixture.detectChanges();

        expect(exitFullscreen).toHaveBeenCalledTimes(1);
        expect(component.isFullscreen()).toBe(false);
    });

    it('reports fullscreen owned by the view host, not by the engine surface', () => {
        fullscreenElement = engineSurface;
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(component.isFullscreen()).toBe(false);

        fullscreenElement = viewHost;
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(component.isFullscreen()).toBe(true);
    });
});

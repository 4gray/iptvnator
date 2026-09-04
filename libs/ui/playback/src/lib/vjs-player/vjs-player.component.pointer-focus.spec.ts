import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls/web-player-controls.flag';
import type { VjsPlayerComponent as VjsPlayerComponentInstance } from './vjs-player.component';
import type { VideoJsPlayer } from './vjs-player.types';

const videoJsMock = jest.fn();

jest.unstable_mockModule('video.js', () => ({ default: videoJsMock }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));
jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: { ERROR: 'error' },
        createPlayer: jest.fn(),
        isSupported: jest.fn(() => false),
    },
}));

// Real `attachVjsPointerFocusRelease` is exercised through the shell so the
// test proves both the ngAfterViewInit wiring (the view child must be
// resolved) and that the shared-controls guard and teardown behave.
describe('VjsPlayerComponent pointer focus release wiring', () => {
    let VjsPlayerComponent: typeof import('./vjs-player.component').VjsPlayerComponent;
    let fixture: ComponentFixture<VjsPlayerComponentInstance>;

    beforeAll(async () => {
        ({ VjsPlayerComponent } = await import('./vjs-player.component'));
    });

    beforeEach(() => {
        videoJsMock.mockReset().mockImplementation(() => createPlayerMock());
    });

    afterEach(() => {
        fixture?.destroy();
    });

    const mount = async (sharedControls: boolean) => {
        await TestBed.configureTestingModule({
            imports: [VjsPlayerComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: WEB_PLAYER_SHARED_CONTROLS,
                    useValue: sharedControls,
                },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(VjsPlayerComponent);
        fixture.componentRef.setInput('options', {
            sources: [{ src: 'https://example.test/movie.mp4' }],
        });
        fixture.detectChanges();
        return fixture.nativeElement.querySelector(
            '.vjs-player-shell'
        ) as HTMLElement;
    };

    /** A control the mocked player never renders, so the test owns it. */
    const addControl = (shell: HTMLElement) => {
        const button = document.createElement('button');
        shell.appendChild(button);
        return button;
    };

    const pressAndFocus = (shell: HTMLElement, control: HTMLElement) => {
        shell.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        control.focus();
    };

    it('releases the focus a pointer press leaves on a control (attach reached the resolved shell)', async () => {
        const shell = await mount(false);
        const control = addControl(shell);

        pressAndFocus(shell, control);

        expect(document.activeElement).not.toBe(control);
    });

    it('leaves the control focused after the component is destroyed', async () => {
        const shell = await mount(false);
        const control = addControl(shell);
        fixture.destroy();

        pressAndFocus(shell, control);

        expect(document.activeElement).toBe(control);
    });

    it('does not attach when shared controls own the surface', async () => {
        const shell = await mount(true);
        const control = addControl(shell);

        pressAndFocus(shell, control);

        expect(document.activeElement).toBe(control);
    });
});

function createPlayerMock(): VideoJsPlayer {
    const player = {
        on: jest.fn(),
        off: jest.fn(),
        ready: jest.fn(),
        getChild: jest.fn(() => null),
        audioTracks: jest.fn(() => null),
        textTracks: jest.fn(() => null),
        currentTime: jest.fn(() => 0),
        duration: jest.fn(() => 0),
        error: jest.fn(() => null),
        paused: jest.fn(() => true),
        play: jest.fn(() => Promise.resolve()),
        pause: jest.fn(),
        volume: jest.fn(() => 1),
        muted: jest.fn(() => false),
        src: jest.fn(),
        reset: jest.fn(),
        dispose: jest.fn(),
        isFullscreen: jest.fn(() => false),
        requestFullscreen: jest.fn(),
        exitFullscreen: jest.fn(),
        controlBar: { getChild: jest.fn(() => null) },
    };
    return player as unknown as VideoJsPlayer;
}

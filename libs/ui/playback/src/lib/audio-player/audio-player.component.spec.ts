import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { AudioPlayerComponent } from './audio-player.component';

describe('AudioPlayerComponent', () => {
    let fixture: ComponentFixture<AudioPlayerComponent>;
    let component: AudioPlayerComponent;
    let store: { dispatch: jest.Mock };
    let playSpy: jest.SpyInstance;
    let pauseSpy: jest.SpyInstance;
    let loadSpy: jest.SpyInstance;

    beforeEach(async () => {
        localStorage.clear();
        store = { dispatch: jest.fn() };
        playSpy = jest
            .spyOn(HTMLMediaElement.prototype, 'play')
            .mockResolvedValue(undefined);
        pauseSpy = jest
            .spyOn(HTMLMediaElement.prototype, 'pause')
            .mockImplementation(() => undefined);
        loadSpy = jest
            .spyOn(HTMLMediaElement.prototype, 'load')
            .mockImplementation(() => undefined);

        await TestBed.configureTestingModule({
            imports: [AudioPlayerComponent, TranslateModule.forRoot()],
            providers: [{ provide: Store, useValue: store }],
        }).compileComponents();
    });

    afterEach(() => {
        fixture?.destroy();
        localStorage.clear();
        jest.restoreAllMocks();
    });

    function createComponent(url = 'https://example.com/radio.mp3') {
        fixture = TestBed.createComponent(AudioPlayerComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('url', url);
        fixture.componentRef.setInput('channelName', 'Example Radio');
        fixture.detectChanges();
        return fixture.nativeElement.querySelector('audio') as HTMLAudioElement;
    }

    it('restores the persisted volume and applies it when a stream loads', () => {
        localStorage.setItem('volume', '0.42');

        const audio = createComponent();

        expect(component.volume()).toBe(0.42);
        expect(audio.src).toBe('https://example.com/radio.mp3');
        expect(audio.volume).toBe(0.42);
        expect(loadSpy).toHaveBeenCalled();
        expect(playSpy).toHaveBeenCalled();
        expect(component.playState()).toBe('play');
    });

    it('clamps volume updates and persists them to localStorage', () => {
        const audio = createComponent();

        component.setVolume(1.5);
        expect(component.volume()).toBe(1);
        expect(audio.volume).toBe(1);
        expect(localStorage.getItem('volume')).toBe('1');

        component.setVolume(-0.25);
        expect(component.volume()).toBe(0);
        expect(audio.volume).toBe(0);
        expect(localStorage.getItem('volume')).toBe('0');
    });

    it('handles volume and mute keyboard shortcuts without focusing inputs', () => {
        createComponent();
        component.setVolume(0.5);

        const upEvent = createKeyboardEvent('ArrowUp');
        component.handleKeyboard(upEvent);
        expect(upEvent.preventDefault).toHaveBeenCalled();
        expect(component.volume()).toBe(0.55);

        const downEvent = createKeyboardEvent('ArrowDown');
        component.handleKeyboard(downEvent);
        expect(downEvent.preventDefault).toHaveBeenCalled();
        expect(component.volume()).toBe(0.5);

        const muteEvent = createKeyboardEvent('M');
        component.handleKeyboard(muteEvent);
        expect(muteEvent.preventDefault).toHaveBeenCalled();
        expect(component.isMuted()).toBe(true);
        expect(component.volume()).toBe(0);

        const inputEvent = createKeyboardEvent('ArrowUp', {
            target: document.createElement('input'),
        });
        component.handleKeyboard(inputEvent);
        expect(inputEvent.preventDefault).not.toHaveBeenCalled();
        expect(component.volume()).toBe(0);
    });

    it('restores the previous volume when unmuting', () => {
        const audio = createComponent();
        component.setVolume(0.65);

        component.mute();
        expect(audio.muted).toBe(true);
        expect(component.isMuted()).toBe(true);
        expect(component.volume()).toBe(0);

        component.mute();
        expect(audio.muted).toBe(false);
        expect(component.isMuted()).toBe(false);
        expect(component.volume()).toBe(0.65);
        expect(localStorage.getItem('volume')).toBe('0.65');
    });

    it('emits or dispatches adjacent channel switches based on input mode', () => {
        createComponent();
        const emitted: string[] = [];
        component.channelSwitchRequested.subscribe((direction) =>
            emitted.push(direction)
        );

        component.switchChannel('next');
        expect(store.dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                direction: 'next',
            })
        );
        expect(emitted).toEqual([]);

        fixture.componentRef.setInput('dispatchAdjacentChannelAction', false);
        fixture.detectChanges();
        component.switchChannel('previous');

        expect(emitted).toEqual(['previous']);
        expect(store.dispatch).toHaveBeenCalledTimes(1);
    });

    it('pauses the stream when the component is destroyed', () => {
        createComponent();

        fixture.destroy();

        expect(pauseSpy).toHaveBeenCalled();
    });
});

function createKeyboardEvent(
    key: string,
    options: { target?: EventTarget } = {}
): KeyboardEvent & { preventDefault: jest.Mock } {
    const event = new KeyboardEvent('keydown', { key }) as KeyboardEvent & {
        preventDefault: jest.Mock;
    };
    Object.defineProperty(event, 'preventDefault', {
        configurable: true,
        value: jest.fn(),
    });
    if (options.target) {
        Object.defineProperty(event, 'target', {
            configurable: true,
            value: options.target,
        });
    }
    return event;
}

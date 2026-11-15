import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
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
        expect(audio.muted).toBe(true);
        expect(localStorage.getItem('volume')).toBe('0');
    });

    it('applies external volume input changes to the current audio element', () => {
        const audio = createComponent();

        fixture.componentRef.setInput('volume', 0.25);
        fixture.detectChanges();

        expect(component.volume()).toBe(0.25);
        expect(audio.volume).toBe(0.25);
        expect(localStorage.getItem('volume')).toBe('0.25');
        expect(loadSpy).toHaveBeenCalledTimes(1);
    });

    it('emits local volume changes so parent playback state stays current', () => {
        createComponent();
        const emitted: number[] = [];
        component.volumeChange.subscribe((volume) => emitted.push(volume));

        component.setVolume(0.3);

        expect(emitted).toEqual([0.3]);
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

    it('ignores keyboard shortcuts while inside an inert region', () => {
        createComponent();
        component.setVolume(0.5);
        // e.g. the workspace's phone context drawer marks the route content
        // inert while open; document-level key listeners still fire, so the
        // player must opt out itself.
        fixture.nativeElement.setAttribute('inert', '');

        const upEvent = createKeyboardEvent('ArrowUp');
        component.handleKeyboard(upEvent);

        expect(upEvent.preventDefault).not.toHaveBeenCalled();
        expect(component.volume()).toBe(0.5);
    });

    it.each(['dialog', 'alertdialog'])(
        'leaves reading keys to a focused %s while radio is playing',
        (role) => {
            const audio = createComponent();
            component.setVolume(0.5);
            const emitted = jest.fn();
            component.volumeChange.subscribe(emitted);
            const dialog = document.createElement('div');
            dialog.setAttribute('role', role);
            const region = document.createElement('div');
            region.setAttribute('role', 'region');
            region.tabIndex = 0;
            dialog.append(region);
            document.body.append(dialog);
            region.focus();

            try {
                for (const key of ['ArrowUp', 'ArrowDown', 'm', 'M']) {
                    const event = new KeyboardEvent('keydown', {
                        key,
                        bubbles: true,
                        cancelable: true,
                    });
                    region.dispatchEvent(event);
                    expect(event.defaultPrevented).toBe(false);
                    expect(component.volume()).toBe(0.5);
                    expect(audio.volume).toBe(0.5);
                    expect(audio.muted).toBe(false);
                    expect(localStorage.getItem('volume')).toBe('0.5');
                }
                expect(component.playState()).toBe('play');
                expect(emitted).not.toHaveBeenCalled();
            } finally {
                dialog.remove();
            }

            document.body.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                    cancelable: true,
                })
            );
            expect(component.volume()).toBe(0.45);
            expect(emitted).toHaveBeenCalledWith(0.45);
        }
    );

    it('restores the previous volume when unmuting', () => {
        const audio = createComponent();
        component.setVolume(0.65);

        component.mute();
        expect(audio.volume).toBe(0);
        expect(audio.muted).toBe(true);
        expect(component.isMuted()).toBe(true);
        expect(component.volume()).toBe(0);

        component.mute();
        expect(audio.muted).toBe(false);
        expect(audio.volume).toBe(0.65);
        expect(component.isMuted()).toBe(false);
        expect(component.volume()).toBe(0.65);
        expect(localStorage.getItem('volume')).toBe('0.65');
    });

    it('unmutes to an audible volume when the stored volume is zero', () => {
        localStorage.setItem('volume', '0');
        const audio = createComponent();
        expect(component.isMuted()).toBe(true);
        expect(audio.muted).toBe(true);

        component.mute();

        expect(component.isMuted()).toBe(false);
        expect(component.volume()).toBe(0.5);
        expect(audio.volume).toBe(0.5);
        expect(audio.muted).toBe(false);
    });

    it('restores the default volume after muting with an invalid saved value', () => {
        localStorage.setItem('volume', 'invalid');
        const audio = createComponent();
        component.mute();
        component.mute();

        expect(audio.volume).toBe(1);
        expect(audio.muted).toBe(false);
    });

    it('unmutes when the last audible volume would round to zero', () => {
        localStorage.setItem('volume', '0.004');
        const audio = createComponent();
        component.mute();
        component.mute();

        expect(audio.volume).toBe(0.01);
        expect(audio.muted).toBe(false);
    });

    it('treats raising the volume while muted as an unmute', () => {
        const audio = createComponent();
        component.setVolume(0.8);
        component.mute();

        component.setVolume(0.3);

        expect(component.isMuted()).toBe(false);
        expect(audio.volume).toBe(0.3);
        expect(audio.muted).toBe(false);
    });

    it('restores the volume a slider drag to zero left behind', () => {
        createComponent();
        component.setVolume(0.7);
        component.setVolume(0);

        component.mute();

        expect(component.volume()).toBe(0.7);
    });

    it('unmutes to the last audible volume after the host pushed zero', () => {
        const audio = createComponent();
        fixture.componentRef.setInput('volume', 0.6);
        fixture.detectChanges();
        fixture.componentRef.setInput('volume', 0);
        fixture.detectChanges();
        expect(audio.muted).toBe(true);

        component.mute();

        expect(component.volume()).toBe(0.6);
    });

    describe('play state follows the audio element', () => {
        it.each(['pause', 'ended', 'error'] as const)(
            'shows paused after %s (media keys, a failed station)',
            (eventType) => {
                const audio = createComponent();
                expect(component.playState()).toBe('play');

                audio.dispatchEvent(new Event(eventType));

                expect(component.playState()).toBe('paused');
            }
        );

        it('shows playing when the element resumes on its own', () => {
            const audio = createComponent();
            audio.dispatchEvent(new Event('pause'));

            audio.dispatchEvent(new Event('play'));

            expect(component.playState()).toBe('play');
        });

        it('shows paused when playback is refused', async () => {
            jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            playSpy.mockRejectedValueOnce(new Error('synthetic refusal'));

            createComponent();
            await Promise.resolve();
            await Promise.resolve();

            expect(component.playState()).toBe('paused');
        });

        it('stays paused after a failed retry even when the element reports unpaused', async () => {
            jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            const audio = createComponent();
            Object.defineProperty(audio, 'paused', { value: false });
            audio.dispatchEvent(new Event('error'));
            playSpy.mockRejectedValueOnce(
                new DOMException('', 'NotSupportedError')
            );

            fixture.nativeElement.querySelector('.play-btn').click();
            await Promise.resolve();

            expect(component.playState()).toBe('paused');
        });

        it('keeps a station playing when an older play() is rejected late', async () => {
            jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            let rejectOld: (error: Error) => void = () => undefined;
            playSpy.mockImplementationOnce(
                () => new Promise<void>((_, reject) => (rejectOld = reject))
            );
            createComponent();
            fixture.componentRef.setInput(
                'url',
                'https://example.com/next.mp3'
            );
            fixture.detectChanges();
            expect(playSpy).toHaveBeenCalledTimes(2);

            rejectOld(new Error('synthetic abort'));
            await Promise.resolve();
            await Promise.resolve();

            expect(component.playState()).toBe('play');
        });
    });

    it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }])(
        'leaves %o chords to the app and the system',
        (modifier) => {
            createComponent();
            component.setVolume(0.5);

            for (const key of ['m', 'M', 'ArrowUp', 'ArrowDown']) {
                const event = createKeyboardEvent(key, { init: modifier });
                component.handleKeyboard(event);
                expect(event.preventDefault).not.toHaveBeenCalled();
            }
            expect(component.volume()).toBe(0.5);
        }
    );

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

    it('records the station in history only after it has played', () => {
        const audio = createComponent('https://example.com/station.mp3');
        const commit = jest.fn();
        TestBed.inject(PlaybackHistoryGate).defer(
            { streamUrls: ['https://example.com/station.mp3'] },
            commit
        );
        Object.defineProperty(audio, 'paused', {
            configurable: true,
            value: false,
        });
        const playTo = (position: number) => {
            Object.defineProperty(audio, 'currentTime', {
                configurable: true,
                value: position,
            });
            audio.dispatchEvent(new Event('timeupdate'));
        };

        playTo(0);
        playTo(1);
        expect(commit).not.toHaveBeenCalled();

        playTo(2);
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('does not record a station that never advances', () => {
        const audio = createComponent('https://example.com/dead.mp3');
        const commit = jest.fn();
        TestBed.inject(PlaybackHistoryGate).defer(
            { streamUrls: ['https://example.com/dead.mp3'] },
            commit
        );

        audio.dispatchEvent(new Event('timeupdate'));
        audio.dispatchEvent(new Event('timeupdate'));

        expect(commit).not.toHaveBeenCalled();
    });

    it('pauses the stream when the component is destroyed', () => {
        createComponent();

        fixture.destroy();

        expect(pauseSpy).toHaveBeenCalled();
    });
});

function createKeyboardEvent(
    key: string,
    options: { target?: EventTarget; init?: KeyboardEventInit } = {}
): KeyboardEvent & { preventDefault: jest.Mock } {
    const event = new KeyboardEvent('keydown', {
        key,
        ...options.init,
    }) as KeyboardEvent & {
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

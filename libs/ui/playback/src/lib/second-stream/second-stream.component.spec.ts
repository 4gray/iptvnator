import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { EmbeddedMpvPlayerComponent } from '../embedded-mpv-player/embedded-mpv-player.component';
import { createLoadingSession } from '../embedded-mpv-player/embedded-mpv-session-factory';
import { SecondStreamComponent } from './second-stream.component';

describe('SecondStreamComponent', () => {
    const playback = {
        title: 'Synthetic movie',
        streamUrl: 'https://media.example.test/movie.webm',
        isLive: false,
    };
    let component: SecondStreamComponent;
    let first: EmbeddedMpvPlayerComponent;
    let second: EmbeddedMpvPlayerComponent;
    let volume: jest.Mock;
    const originalElectron = Object.getOwnPropertyDescriptor(
        window,
        'electron'
    );

    beforeEach(() => {
        volume = jest.fn().mockResolvedValue(null);
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { setEmbeddedMpvVolume: volume },
        });
        TestBed.configureTestingModule({
            imports: [
                TranslateModule.forRoot(),
                SecondStreamComponent,
                EmbeddedMpvPlayerComponent,
            ],
        });
        TestBed.overrideComponent(SecondStreamComponent, {
            set: { template: '' },
        });
        TestBed.overrideComponent(EmbeddedMpvPlayerComponent, {
            set: { template: '' },
        });
        const makePlayer = (id: string) => {
            const fixture = TestBed.createComponent(EmbeddedMpvPlayerComponent);
            fixture.componentRef.setInput('playback', playback);
            const player = fixture.componentInstance;
            player.controller.support.set({
                supported: true,
                engine: 'frame-copy',
                platform: 'test',
            });
            player.controller.sessionId.set(id);
            player.controller.session.set({
                ...createLoadingSession(playback, 0.5),
                id,
                status: 'playing',
            });
            return player;
        };
        first = makePlayer('first');
        second = makePlayer('second');
        const fixture = TestBed.createComponent(SecondStreamComponent);
        fixture.componentRef.setInput('primary', first);
        component = fixture.componentInstance;
        Object.defineProperty(component, 'secondary', {
            value: signal(second),
        });
    });
    afterEach(() => {
        TestBed.resetTestingModule();
        if (originalElectron)
            Object.defineProperty(window, 'electron', originalElectron);
        else Reflect.deleteProperty(window, 'electron');
    });
    it('replaces the companion through the picker and retains the primary', async () => {
        const replacement = { ...playback, title: 'Synthetic replacement' };
        component.editing.set(true);
        await component.selectPlayback(playback);
        await component.selectPlayback(replacement);
        expect(component.playback()).toBe(playback);

        component.editing.set(true);
        await component.selectPlayback(replacement);
        expect(component.playback()).toBe(replacement);
        expect(component.editing()).toBe(false);
        expect(first.controller.sessionId()).toBe('first');
        expect(volume).not.toHaveBeenCalled();
    });

    it('returns sound and the main view to the primary before replacing a swapped companion', async () => {
        component.playback.set(playback);
        component.swapped.set(true);
        component.editing.set(true);
        const replacement = { ...playback, title: 'Synthetic replacement' };

        await component.selectPlayback(replacement);

        expect(component.swapped()).toBe(false);
        expect(component.playback()).toBe(replacement);
        expect(first.controller.sessionId()).toBe('first');
        expect(volume.mock.calls).toEqual([['second', 0], ['first', 0.5]]);
    });

    it('keeps the current selection if the swapped audio handoff fails', async () => {
        component.playback.set(playback);
        component.swapped.set(true);
        component.editing.set(true);
        volume.mockRejectedValue(new Error('helper closed'));

        await component.selectPlayback({ ...playback, title: 'Synthetic replacement' });

        expect(component.swapped()).toBe(true);
        expect(component.playback()).toBe(playback);
        expect(component.error()).toBe(true);
    });

    it('serializes repeated swaps and does not change layout before audio acknowledgement', async () => {
        let confirm!: () => void;
        volume.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    confirm = () => resolve(null);
                })
        );
        const pending = component.swap();
        expect(component.busy()).toBe(true);
        expect(component.swapped()).toBe(false);
        expect(await component.swap()).toBe(false);
        confirm();
        expect(await pending).toBe(true);
        expect(component.swapped()).toBe(true);
        expect(volume.mock.calls).toEqual([
            ['first', 0],
            ['second', 0.5],
        ]);
    });
    it('retains the audible companion volume across retry and blocks retry during handoff', () => {
        component.swapped.set(true);
        second.controller.session.set({
            ...createLoadingSession(playback, 0.35),
            id: 'second',
            status: 'playing',
        });
        TestBed.tick();
        expect(component.audibleVolume()).toBe(0.35);
        second.controller.session.set(null);
        TestBed.tick();
        expect(component.audibleVolume()).toBe(0.35);
        Object.defineProperty(second, 'retryEnabled', { value: signal(false) });
        const retry = jest.spyOn(second.controller, 'retry');
        second.retry();
        expect(retry).not.toHaveBeenCalled();
    });

    it('can close a failed companion without restarting the retained primary', async () => {
        component.playback.set({ ...playback, isLive: true });
        component.swapped.set(true);
        volume.mockRejectedValue(new Error('helper closed'));
        await component.close();
        expect(component.active()).toBe(false);
        expect(component.swapped()).toBe(false);
        expect(first.controller.sessionId()).toBe('first');
        expect(volume).not.toHaveBeenCalledWith('first', expect.anything());
    });
});

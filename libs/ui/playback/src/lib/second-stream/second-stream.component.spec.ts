import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    SecondStreamCatalogService,
    type SecondStreamSelection,
} from '@iptvnator/portal/shared/data-access';
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
    const selection: SecondStreamSelection = {
        playback,
        item: {
            uid: 'synthetic-channel',
            name: 'Synthetic channel',
            sourceType: 'm3u',
            contentType: 'live',
            playlistId: 'synthetic-playlist',
            playlistName: 'Synthetic playlist',
        },
    };
    let component: SecondStreamComponent;
    let first: EmbeddedMpvPlayerComponent;
    let second: EmbeddedMpvPlayerComponent;
    let volume: jest.Mock;
    const allowed = signal(true);
    const originalElectron = Object.getOwnPropertyDescriptor(
        window,
        'electron'
    );

    beforeEach(() => {
        volume = jest.fn().mockResolvedValue(null);
        allowed.set(true);
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { setEmbeddedMpvVolume: volume },
        });
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: SecondStreamCatalogService,
                    useValue: { isAllowed: allowed },
                },
            ],
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
        await component.selectPlayback(selection);
        await component.selectPlayback({ ...selection, playback: replacement });
        expect(component.playback()).toBe(playback);

        component.editing.set(true);
        await component.selectPlayback({ ...selection, playback: replacement });
        expect(component.playback()).toBe(replacement);
        expect(component.editing()).toBe(false);
        expect(first.controller.sessionId()).toBe('first');
        expect(volume).not.toHaveBeenCalled();
    });

    it('returns sound and the main view to the primary before replacing a swapped companion', async () => {
        component.selection.set(selection);
        component.swapped.set(true);
        component.editing.set(true);
        const replacement = { ...playback, title: 'Synthetic replacement' };

        await component.selectPlayback({ ...selection, playback: replacement });

        expect(component.swapped()).toBe(false);
        expect(component.playback()).toBe(replacement);
        expect(first.controller.sessionId()).toBe('first');
        expect(volume.mock.calls).toEqual([
            ['second', 0],
            ['first', 0.5],
        ]);
    });

    it('keeps the current selection if the swapped audio handoff fails', async () => {
        component.selection.set(selection);
        component.swapped.set(true);
        component.editing.set(true);
        volume.mockRejectedValue(new Error('helper closed'));

        await component.selectPlayback({
            ...selection,
            playback: { ...playback, title: 'Synthetic replacement' },
        });

        expect(component.swapped()).toBe(true);
        expect(component.playback()).toBe(playback);
        expect(component.error()).toBe(true);
    });

    it('stops the companion at relock and does not resume it on unlock', async () => {
        component.editing.set(true);
        await component.selectPlayback(selection);
        expect(component.active()).toBe(true);
        allowed.set(false);
        TestBed.tick();
        expect(component.active()).toBe(false);
        allowed.set(true);
        TestBed.tick();
        expect(component.active()).toBe(false);
        expect(first.controller.sessionId()).toBe('first');
    });

    it('waits for the companion mute before restoring sound on relock', async () => {
        component.selection.set(selection);
        component.swapped.set(true);
        TestBed.tick();
        let confirm!: () => void;
        volume.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    confirm = () => resolve(null);
                })
        );

        allowed.set(false);
        TestBed.tick();
        expect(component.active()).toBe(false);
        expect(volume.mock.calls).toEqual([['second', 0]]);

        confirm();
        await Promise.resolve();
        expect(volume.mock.calls).toEqual([
            ['second', 0],
            ['first', 0.5],
        ]);
    });

    it('keeps primary audio muted if the relocked companion cannot acknowledge a mute', async () => {
        component.selection.set(selection);
        component.swapped.set(true);
        volume.mockRejectedValueOnce(new Error('helper unavailable'));

        allowed.set(false);
        TestBed.tick();
        await Promise.resolve();

        expect(component.selection()).toBeNull();
        expect(component.swapped()).toBe(false);
        expect(volume.mock.calls).toEqual([['second', 0]]);
    });

    it('does not unmute a companion that is locked during a swap', async () => {
        component.editing.set(true);
        await component.selectPlayback(selection);
        let confirm!: () => void;
        volume.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    confirm = () => resolve(null);
                })
        );
        const pending = component.swap();
        allowed.set(false);
        TestBed.tick();
        expect(component.active()).toBe(false);
        confirm();
        expect(await pending).toBe(false);
        TestBed.tick();
        await Promise.resolve();
        expect(component.swapped()).toBe(false);
        expect(volume.mock.calls).toEqual([
            ['first', 0],
            ['second', 0],
            ['first', 0.5],
        ]);
    });

    it('serializes repeated swaps and does not change layout before audio acknowledgement', async () => {
        component.selection.set(selection);
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
        component.selection.set(selection);
        component.swapped.set(true);
        volume.mockRejectedValue(new Error('helper closed'));
        await component.close();
        expect(component.active()).toBe(false);
        expect(component.swapped()).toBe(false);
        expect(first.controller.sessionId()).toBe('first');
        expect(volume).not.toHaveBeenCalledWith('first', expect.anything());
    });
});

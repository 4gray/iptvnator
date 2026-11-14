import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import {
    SecondStreamCatalogService,
    UnifiedRecentDataService,
    type SecondStreamSelection,
} from '@iptvnator/portal/shared/data-access';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { PLAYBACK_ACTIVITY_EVENTS } from '@iptvnator/services/activity-events';
import { TranslateModule } from '@ngx-translate/core';
import { NEVER, Subject } from 'rxjs';
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
    let fixture: ComponentFixture<SecondStreamComponent>;
    let first: EmbeddedMpvPlayerComponent;
    let second: EmbeddedMpvPlayerComponent;
    let volume: jest.Mock;
    let afterClosed: Subject<SecondStreamSelection | undefined>;
    const dialogClose = jest.fn();
    const openDialog = jest.fn();
    const savePlaybackPosition = jest.fn();
    const recordPlayback = jest.fn();
    const activity = {
        active: jest.fn(() => false),
        begin: jest.fn().mockResolvedValue(undefined),
        checkpoint: jest.fn().mockResolvedValue(undefined),
    };
    const allowed = signal(true);
    const originalElectron = Object.getOwnPropertyDescriptor(
        window,
        'electron'
    );

    beforeEach(() => {
        volume = jest.fn().mockResolvedValue(null);
        afterClosed = new Subject();
        dialogClose
            .mockReset()
            .mockImplementation(() => afterClosed.next(undefined));
        openDialog.mockReset().mockReturnValue({
            close: dialogClose,
            afterClosed: () => afterClosed,
        });
        savePlaybackPosition.mockReset().mockResolvedValue(undefined);
        recordPlayback.mockReset().mockResolvedValue(undefined);
        allowed.set(true);
        activity.active.mockReturnValue(false);
        activity.begin.mockClear();
        activity.checkpoint.mockClear();
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { setEmbeddedMpvVolume: volume },
        });
        TestBed.configureTestingModule({
            providers: [
                { provide: PLAYBACK_ACTIVITY_EVENTS, useValue: activity },
                {
                    provide: MatDialog,
                    useValue: {
                        open: openDialog,
                        openDialogs: [],
                        afterOpened: NEVER,
                        afterAllClosed: NEVER,
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: { savePlaybackPosition },
                },
                {
                    provide: UnifiedRecentDataService,
                    useValue: { recordPlayback },
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            pathFromRoot: [
                                {
                                    routeConfig: { path: 'xtreams/:id' },
                                    paramMap: convertToParamMap({
                                        id: 'source-1',
                                    }),
                                },
                                {
                                    routeConfig: { path: 'movies' },
                                    paramMap: convertToParamMap({}),
                                },
                            ],
                        },
                    },
                },
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
        fixture = TestBed.createComponent(SecondStreamComponent);
        fixture.componentRef.setInput('primary', first);
        component = fixture.componentInstance;
        Object.defineProperty(component, 'secondary', {
            value: signal(second),
        });
    });

    it('opens one picker on the active portal and applies its selection', async () => {
        const opening = component.openPicker();
        await component.openPicker();
        await opening;
        expect(openDialog).toHaveBeenCalledTimes(1);
        expect(openDialog).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                data: {
                    returningToOriginal: false,
                    initialPlaylist: 'source-1',
                },
            })
        );
        afterClosed.next(selection);
        expect(component.selection()).toBe(selection);
        expect(component.editing()).toBe(false);
    });

    it('closes the picker when frame-copy support is lost', async () => {
        const opening = component.openPicker();
        first.controller.support.set(null);
        await opening;
        expect(openDialog).not.toHaveBeenCalled();
        expect(component.editing()).toBe(false);

        first.controller.support.set({
            supported: true,
            engine: 'frame-copy',
            platform: 'test',
        });
        await component.openPicker();
        first.controller.support.set(null);
        TestBed.tick();
        expect(dialogClose).toHaveBeenCalledTimes(1);
        expect(component.editing()).toBe(false);
    });

    it('reclamps the floating view on viewport changes and removes listeners on destroy', () => {
        const stage = document.createElement('section');
        const measure = jest.spyOn(component.placement, 'measure');
        const resizeObserver = Object.getOwnPropertyDescriptor(
            globalThis,
            'ResizeObserver'
        );
        const observe = jest.fn();
        const disconnect = jest.fn();
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            value: class {
                observe = observe;
                disconnect = disconnect;
            },
        });
        try {
            fixture.componentRef.setInput('fullscreenTarget', stage);
            fixture.detectChanges();
            expect(observe).toHaveBeenCalledWith(stage);
            expect(measure).toHaveBeenCalledTimes(1);
            window.dispatchEvent(new Event('resize'));
            document.dispatchEvent(new Event('fullscreenchange'));
            expect(measure).toHaveBeenCalledTimes(3);

            fixture.destroy();
            expect(disconnect).toHaveBeenCalledTimes(1);
            window.dispatchEvent(new Event('resize'));
            document.dispatchEvent(new Event('fullscreenchange'));
            expect(measure).toHaveBeenCalledTimes(3);
        } finally {
            fixture.destroy();
            if (resizeObserver)
                Object.defineProperty(
                    globalThis,
                    'ResizeObserver',
                    resizeObserver
                );
            else Reflect.deleteProperty(globalThis, 'ResizeObserver');
        }
    });

    it('lists both streams in view order and pauses the small view after a swap', async () => {
        const companion = { ...playback, title: 'Fixture companion' };
        component.selection.set({ ...selection, playback: companion });
        second.controller.session.set({
            ...createLoadingSession(companion, 0),
            id: 'second',
            status: 'playing',
        });
        expect(component.openStreams()).toEqual([
            { playback, small: false, muted: false },
            { playback: companion, small: true, muted: true },
        ]);
        await component.swap();
        expect(
            component.openStreams().map((stream) => stream.playback.title)
        ).toEqual([companion.title, playback.title]);
        const pause = jest
            .spyOn(first.controller, 'togglePaused')
            .mockResolvedValue(undefined);
        component.pauseSmall();
        expect(pause).toHaveBeenCalledTimes(1);
    });

    it('records local progress and history after companion playback advances', async () => {
        const media = {
            ...playback,
            contentInfo: {
                playlistId: 'source-1',
                contentType: 'vod' as const,
                contentXtreamId: 42,
            },
        };
        component.editing.set(true);
        await component.selectPlayback({ ...selection, playback: media });
        const current = component.playback();
        Object.defineProperty(second, 'playback', { value: signal(current) });
        component.savePosition({
            currentTime: 12,
            duration: 120,
            playing: true,
        });
        component.savePosition({
            currentTime: 14,
            duration: 120,
            playing: true,
        });
        second.controller.session.update(
            (session) => session && { ...session, status: 'paused' }
        );
        component.savePosition({
            currentTime: 22,
            duration: 120,
            playing: false,
        });
        expect(recordPlayback).toHaveBeenCalledTimes(1);
        expect(recordPlayback).toHaveBeenCalledWith(selection.item);
        expect(savePlaybackPosition).toHaveBeenLastCalledWith(
            'source-1',
            expect.objectContaining({
                contentXtreamId: 42,
                positionSeconds: 22,
            })
        );
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

    it('owns and checkpoints the companion progress when activity sync is enabled', async () => {
        activity.active.mockReturnValue(true);
        const content = {
            ...playback,
            startTime: 20,
            contentInfo: {
                playlistId: 'synthetic-playlist',
                contentType: 'vod' as const,
                contentXtreamId: 42,
            },
        };
        component.editing.set(true);
        await component.selectPlayback({ ...selection, playback: content });
        const owned = component.playback();
        if (!owned) throw new Error('Missing companion playback');
        const sessionId = owned.contentInfo?.activitySessionId;
        expect(sessionId).toBeTruthy();
        expect(activity.begin).toHaveBeenCalledWith(
            owned.contentInfo,
            20,
            content.title
        );

        Object.defineProperty(second, 'playback', { value: signal(owned) });
        component.savePosition({
            currentTime: 4,
            duration: 100,
            playing: true,
        });
        expect(activity.checkpoint).not.toHaveBeenCalled();
        component.savePosition({
            currentTime: 22,
            duration: 100,
            playing: true,
        });
        component.savePosition({
            currentTime: 28,
            duration: 100,
            playing: true,
        });
        await component.close();

        expect(activity.checkpoint).toHaveBeenLastCalledWith(
            expect.objectContaining({
                activitySessionId: sessionId,
                positionSeconds: 28,
            })
        );
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
        activity.active.mockReturnValue(false);
        activity.begin.mockClear();
        activity.checkpoint.mockClear();
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

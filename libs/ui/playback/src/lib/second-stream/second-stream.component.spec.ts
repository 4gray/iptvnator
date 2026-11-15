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
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom, NEVER, Subject } from 'rxjs';
import { EmbeddedMpvPlayerComponent } from '../embedded-mpv-player/embedded-mpv-player.component';
import { createLoadingSession } from '../embedded-mpv-player/embedded-mpv-session-factory';
import type {
    CompanionSlot,
    MultiviewSlot,
    SecondStreamPickerData,
} from './second-stream-open-stream';
import { SecondStreamComponent } from './second-stream.component';

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
const distinctSelection = (slot: CompanionSlot): SecondStreamSelection => ({
    ...selection,
    playback: {
        ...playback,
        title: `Synthetic companion ${slot}`,
        streamUrl: `https://media.example.test/companion-${slot}.webm`,
    },
    item: {
        ...selection.item,
        uid: `synthetic-${slot}`,
        playlistId: `source-${slot}`,
    },
});
const vodSelection = (
    id: number,
    startTime?: number
): SecondStreamSelection => ({
    ...selection,
    playback: {
        ...playback,
        startTime,
        contentInfo: {
            playlistId: 'synthetic-playlist',
            contentType: 'vod',
            contentXtreamId: id,
        },
    },
});

function deferredAck() {
    let resolve!: (value: null) => void;
    const promise = new Promise<null>((done) => (resolve = done));
    return { promise, confirm: () => resolve(null) };
}

describe('SecondStreamComponent', () => {
    let component: SecondStreamComponent;
    let fixture: ComponentFixture<SecondStreamComponent>;
    let first: EmbeddedMpvPlayerComponent;
    let volume: jest.Mock;
    let opened: Subject<void>;
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
    const blocked = signal<readonly string[]>([]);
    const originalElectron = Object.getOwnPropertyDescriptor(
        window,
        'electron'
    );
    const route = {
        snapshot: {
            pathFromRoot: [
                {
                    routeConfig: { path: 'xtreams/:id' },
                    paramMap: convertToParamMap({ id: 'source-1' }),
                },
                {
                    routeConfig: { path: 'movies' },
                    paramMap: convertToParamMap({}),
                },
            ],
        },
    };
    const companionPlayers = signal<EmbeddedMpvPlayerComponent[]>([]);
    function makePlayer(
        slot: MultiviewSlot,
        content: ResolvedPortalPlayback,
        gain = 0
    ) {
        const playerFixture = TestBed.createComponent(
            EmbeddedMpvPlayerComponent
        );
        playerFixture.componentRef.setInput('playback', content);
        playerFixture.componentRef.setInput('multiviewSlot', slot);
        const player = playerFixture.componentInstance;
        player.controller.support.set({
            supported: true,
            engine: 'frame-copy',
            platform: 'test',
        });
        player.controller.sessionId.set(`session-${slot}`);
        player.controller.session.set({
            ...createLoadingSession(content, gain),
            id: `session-${slot}`,
            status: 'playing',
        });
        return player;
    }

    beforeEach(() => {
        volume = jest.fn().mockResolvedValue(null);
        opened = new Subject();
        afterClosed = new Subject();
        companionPlayers.set([]);
        dialogClose
            .mockReset()
            .mockImplementation(() => afterClosed.next(undefined));
        openDialog.mockReset().mockImplementation(() => {
            queueMicrotask(() => opened.next());
            return { close: dialogClose, afterClosed: () => afterClosed };
        });
        savePlaybackPosition.mockReset().mockResolvedValue(undefined);
        recordPlayback.mockReset().mockResolvedValue(undefined);
        blocked.set([]);
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
                { provide: ActivatedRoute, useValue: route },
                {
                    provide: SecondStreamCatalogService,
                    useValue: {
                        isAllowed: (item: SecondStreamSelection['item']) =>
                            !blocked().includes(item.playlistId),
                    },
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
        first = makePlayer(1, playback, 0.5);
        fixture = TestBed.createComponent(SecondStreamComponent);
        fixture.componentRef.setInput('primary', first);
        component = fixture.componentInstance;
        Object.defineProperty(component, 'companionPlayers', {
            value: companionPlayers,
        });
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        if (originalElectron)
            Object.defineProperty(window, 'electron', originalElectron);
        else Reflect.deleteProperty(window, 'electron');
    });

    async function dialogFor(slot?: CompanionSlot, replace = false) {
        const ready = firstValueFrom(opened);
        const result = component.openPicker(slot, replace);
        await ready;
        return {
            result,
            data: openDialog.mock.lastCall?.[1].data as SecondStreamPickerData,
        };
    }

    async function choose(
        slot: CompanionSlot,
        choice = distinctSelection(slot),
        replace = false
    ) {
        const { result } = await dialogFor(slot, replace);
        afterClosed.next(choice);
        expect(await result).toBe(slot);
        const accepted = component.selectionAt(slot)?.playback;
        if (!accepted) throw new Error('Missing companion playback');
        const player = makePlayer(slot, accepted);
        companionPlayers.update((players) => [
            ...players.filter((p) => p.multiviewSlot() !== slot),
            player,
        ]);
        return player;
    }

    function report(
        slot: CompanionSlot,
        player: EmbeddedMpvPlayerComponent,
        currentTime: number,
        status: 'playing' | 'paused' | 'ended' = 'playing'
    ) {
        const current = player.playback();
        if (!current) throw new Error('Missing player playback');
        player.controller.session.update(
            (session) => session && { ...session, status }
        );
        component.savePosition(slot, current, player, {
            currentTime,
            duration: 120,
            playing: status === 'playing',
        });
    }

    it('keeps number shortcuts on the grid stage after a pointer selects a control', () => {
        component.setLayout('grid');
        const stage = document.createElement('div');
        stage.dataset['multiviewStage'] = '';
        stage.tabIndex = 0;
        const strip = stage.appendChild(document.createElement('div'));
        const control = strip.appendChild(document.createElement('button'));
        control.setAttribute('aria-pressed', 'false');
        (fixture.nativeElement as HTMLElement).appendChild(stage);
        strip.addEventListener('click', (event) =>
            component.onStripClick(event)
        );
        const click = new MouseEvent('click', { bubbles: true });
        Object.defineProperty(click, 'pointerType', { value: 'mouse' });

        control.focus();
        control.dispatchEvent(click);

        expect(document.activeElement).toBe(stage);
    });

    it('keeps stable slot numbers and playback through layout changes and reuses the first empty slot', async () => {
        expect(component.layout()).toBe('single');
        expect(component.stripVisible()).toBe(false);
        component.setLayout('grid');
        expect(component.layout()).toBe('grid');
        expect(component.stripVisible()).toBe(true);
        expect(component.active()).toBe(false);
        const fourth = await choose(4);
        const retained = component.selectionAt(4);
        await choose(2);
        component.setLayout('side-by-side');
        expect(component.layout()).toBe('grid');
        await component.close(2);
        component.setLayout('side-by-side');
        expect(component.pairedSlot()).toBe(4);
        expect(component.openStreams().map((stream) => stream.slot)).toEqual([
            1, 4,
        ]);
        component.setLayout('pip');
        component.setLayout('grid');
        expect(component.selectionAt(4)).toBe(retained);
        expect(component.firstEmptySlot()).toBe(2);
        const { result } = await dialogFor();
        afterClosed.next(distinctSelection(2));
        expect(await result).toBe(2);
        await choose(3);
        expect(component.firstEmptySlot()).toBeUndefined();
        expect(await component.openPicker()).toBeNull();
        expect(fourth.controller.sessionId()).toBe('session-4');
        expect(first.controller.sessionId()).toBe('session-1');
    });

    it('opens one picker on the active portal and applies its selection', async () => {
        const opening = dialogFor();
        expect(await component.openPicker()).toBeNull();
        const { result, data } = await opening;
        expect(openDialog).toHaveBeenCalledTimes(1);
        expect(data).toEqual(
            expect.objectContaining({
                slot: 2,
                replace: false,
                returningToOriginal: false,
                initialPlaylist: 'source-1',
            })
        );
        afterClosed.next(selection);
        expect(await result).toBe(2);
        expect(component.selectionAt(2)).toBe(selection);
        expect(component.layout()).toBe('pip');
        expect(component.editing()).toBe(false);
    });

    it('closes the picker when frame-copy support is lost', async () => {
        const opening = component.openPicker();
        first.controller.support.set(null);
        expect(await opening).toBeNull();
        expect(openDialog).not.toHaveBeenCalled();
        first.controller.support.set({
            supported: true,
            engine: 'frame-copy',
            platform: 'test',
        });
        const { result } = await dialogFor();
        first.controller.support.set(null);
        TestBed.tick();
        expect(await result).toBeNull();
        expect(dialogClose).toHaveBeenCalledTimes(1);
        expect(component.editing()).toBe(false);
    });

    it('discards picker results from an earlier route or an exited grid', async () => {
        const { result: stale } = await dialogFor(4);
        route.snapshot = { ...route.snapshot };
        afterClosed.next(selection);
        expect(await stale).toBeNull();
        component.setLayout('grid');
        const { result: exited } = await dialogFor(4);
        dialogClose.mockImplementationOnce(() => undefined);
        await component.close();
        afterClosed.next(selection);
        expect(await exited).toBeNull();
        expect(component.layout()).toBe('single');
        expect(component.selectionAt(4)).toBeNull();
    });

    it('discards a stale picker result after primary playback changes', async () => {
        const { result } = await dialogFor(2);
        Object.defineProperty(first, 'playback', {
            value: signal({ ...playback }),
        });
        afterClosed.next(selection);
        expect(await result).toBeNull();
        expect(component.active()).toBe(false);
    });

    it('reclamps the floating window on viewport changes and removes listeners on destroy', () => {
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

    it('lists both streams in view order and pauses the small window after a swap', async () => {
        const second = await choose(2);
        const companion = second.playback();
        TestBed.tick();
        expect(component.openStreams()).toEqual([
            { slot: 1, playback, small: false, muted: false },
            { slot: 2, playback: companion, small: true, muted: true },
        ]);
        expect(await component.swap()).toBe(true);
        expect(
            component.openStreams().map((stream) => stream.playback)
        ).toEqual([companion, playback]);
        const pause = jest
            .spyOn(first.controller, 'togglePaused')
            .mockResolvedValue(undefined);
        component.pauseSmall();
        expect(pause).toHaveBeenCalledTimes(1);
    });

    it('keeps paired layout order and audio independent of selected controls', async () => {
        const fourth = await choose(4);
        expect(await component.swap()).toBe(true);
        volume.mockClear();
        component.setLayout('side-by-side');
        expect(component.controlsSlot()).toBe(4);
        expect(component.openStreams().map((stream) => stream.slot)).toEqual([
            1, 4,
        ]);
        component.selectControls(1);
        expect(component.controlsSlot()).toBe(1);
        expect(component.audioSlot()).toBe(4);
        expect(component.audioController()).toBe(fourth.controller);
        component.setLayout('pip');
        expect(component.controlsSlot()).toBe(4);
        expect(component.openStreams()[0]?.slot).toBe(4);
        component.setLayout('grid');
        expect(component.controlsSlot()).toBe(1);
        expect(volume).not.toHaveBeenCalled();
    });

    it('returns to the original player and floating default when a pair closes', async () => {
        await choose(2);
        component.setLayout('side-by-side');
        component.selectControls(2);
        await component.close(2);
        expect(component.layout()).toBe('single');
        expect(component.controlsSlot()).toBe(1);
        expect(first.controller.sessionId()).toBe('session-1');
        await choose(2);
        expect(component.layout()).toBe('pip');
    });

    it('records independent local progress and history, flushing only the closed companion', async () => {
        const second = await choose(2, vodSelection(42, 20));
        const third = await choose(3, vodSelection(43));
        report(2, second, 12);
        expect(savePlaybackPosition).not.toHaveBeenCalled();
        report(2, second, 22);
        report(3, third, 12);
        report(2, second, 24);
        report(3, third, 14);
        report(2, second, 28);
        report(3, third, 17);
        expect(recordPlayback).toHaveBeenCalledTimes(2);
        component.selectControls(3);
        savePlaybackPosition.mockClear();
        await component.close(2);
        expect(component.controlsSlot()).toBe(3);
        expect(savePlaybackPosition).toHaveBeenCalledTimes(1);
        expect(savePlaybackPosition).toHaveBeenLastCalledWith(
            'synthetic-playlist',
            expect.objectContaining({
                contentXtreamId: 42,
                positionSeconds: 28,
            })
        );
        report(3, third, 22, 'paused');
        expect(savePlaybackPosition).toHaveBeenLastCalledWith(
            'synthetic-playlist',
            expect.objectContaining({
                contentXtreamId: 43,
                positionSeconds: 22,
            })
        );
    });

    it('owns separate activity IDs and checkpoints, ignoring pre-resume and stale replacement events', async () => {
        activity.active.mockReturnValue(true);
        const second = await choose(2, vodSelection(42, 20));
        const owned = second.playback();
        const id = owned?.contentInfo?.activitySessionId;
        expect(id).toBeTruthy();
        expect(activity.begin).toHaveBeenCalledWith(
            owned?.contentInfo,
            20,
            owned?.title
        );
        report(2, second, 4);
        expect(activity.checkpoint).not.toHaveBeenCalled();
        component.setLayout('side-by-side');
        component.setLayout('grid');
        expect(activity.begin).toHaveBeenCalledTimes(1);
        const third = await choose(3, vodSelection(43));
        expect(third.playback()?.contentInfo?.activitySessionId).not.toBe(id);
        report(2, second, 22);
        report(2, second, 28);
        report(3, third, 44);
        const replacement = await choose(2, vodSelection(44), true);
        expect(activity.checkpoint).toHaveBeenLastCalledWith(
            expect.objectContaining({
                activitySessionId: id,
                positionSeconds: 28,
            })
        );
        activity.checkpoint.mockClear();
        report(2, second, 91, 'paused');
        expect(activity.checkpoint).not.toHaveBeenCalled();
        report(2, replacement, 12, 'paused');
        expect(activity.checkpoint).toHaveBeenLastCalledWith(
            expect.objectContaining({
                contentXtreamId: 44,
                positionSeconds: 12,
            })
        );
        expect(savePlaybackPosition).not.toHaveBeenCalled();
    });

    it('uses the canonical VOD position key to reject duplicates in picker and host', async () => {
        activity.active.mockReturnValue(true);
        await choose(4, vodSelection(42));
        const { result, data } = await dialogFor(2);
        const duplicate = {
            ...vodSelection(42),
            playback: {
                ...vodSelection(42).playback,
                title: 'Different title',
                streamUrl: 'https://media.example.test/alternate.webm',
            },
        };
        expect(data.findDuplicateSlot(duplicate)).toBe(4);
        afterClosed.next(duplicate);
        expect(await result).toBeNull();
        expect(component.selectionAt(2)).toBeNull();
        expect(activity.begin).toHaveBeenCalledTimes(1);
    });

    it('returns sound and the large window to the primary before replacing a swapped companion', async () => {
        await choose(2);
        expect(await component.swap()).toBe(true);
        volume.mockClear();
        const replacement = {
            ...selection,
            playback: { ...playback, title: 'Synthetic replacement' },
        };
        await choose(2, replacement, true);
        expect(component.swapped()).toBe(false);
        expect(component.selectionAt(2)).toBe(replacement);
        expect(first.controller.sessionId()).toBe('session-1');
        expect(volume.mock.calls).toEqual([
            ['session-2', 0],
            ['session-1', 0.5],
        ]);
    });

    it('keeps the old companion playback if the replacement audio handoff fails', async () => {
        await choose(2);
        expect(await component.swap()).toBe(true);
        const retained = component.selectionAt(2);
        volume.mockRejectedValueOnce(new Error('helper closed'));
        const { result } = await dialogFor(2, true);
        afterClosed.next(selection);
        expect(await result).toBeNull();
        expect(component.swapped()).toBe(true);
        expect(component.selectionAt(2)).toBe(retained);
        expect(component.error()).toBe(true);
    });

    it('relocks one companion immediately and does not restart it after unlock', async () => {
        await choose(2);
        const third = await choose(3);
        blocked.set(['source-2']);
        expect(component.openStreams().map(({ slot }) => slot)).toEqual([1, 3]);
        TestBed.tick();
        expect(component.isWithheld(2)).toBe(true);
        blocked.set([]);
        await component.close(2);
        expect(component.selectionAt(2)).toBeNull();
        expect(component.active()).toBe(true);
        expect(third.controller.sessionId()).toBe('session-3');
    });

    it('waits for an exact mute acknowledgement before restoring primary sound on relock', async () => {
        await choose(2);
        await component.swap();
        volume.mockClear();
        const mute = deferredAck();
        volume.mockReturnValueOnce(mute.promise);
        blocked.set(['source-2']);
        expect(component.busy()).toBe(true);
        expect(component.audioController()).toBeUndefined();
        TestBed.tick();
        expect(component.active()).toBe(false);
        expect(volume.mock.calls).toEqual([['session-2', 0]]);
        mute.confirm();
        await component.close(2);
        expect(volume.mock.calls).toEqual([
            ['session-2', 0],
            ['session-1', 0.5],
        ]);
    });

    it('keeps the primary muted if a relocked companion cannot acknowledge a mute', async () => {
        await choose(2);
        await component.swap();
        volume
            .mockClear()
            .mockRejectedValueOnce(new Error('helper unavailable'));
        blocked.set(['source-2']);
        TestBed.tick();
        await component.close(2);
        expect(component.selectionAt(2)).toBeNull();
        expect(component.audioSlot()).toBe(1);
        expect(component.audibleVolume()).toBe(0);
        expect(component.error()).toBe(true);
        expect(volume.mock.calls).toEqual([['session-2', 0]]);
    });

    it('does not unmute a companion locked before the outgoing mute resolves', async () => {
        await choose(2);
        const mute = deferredAck();
        volume.mockReturnValueOnce(mute.promise);
        const pending = component.swap();
        blocked.set(['source-2']);
        TestBed.tick();
        mute.confirm();
        expect(await pending).toBe(false);
        await component.close(2);
        expect(component.audioSlot()).toBe(1);
        expect(volume.mock.calls).toEqual([
            ['session-1', 0],
            ['session-1', 0.5],
        ]);
    });

    it('silences the exact incoming session when it relocks during an in-flight unmute', async () => {
        await choose(2);
        const unmuteStarted = deferredAck();
        const unmute = deferredAck();
        volume.mockResolvedValueOnce(null).mockImplementationOnce(() => {
            unmuteStarted.confirm();
            return unmute.promise;
        });
        const pending = component.swap();
        await unmuteStarted.promise;
        blocked.set(['source-2']);
        TestBed.tick();
        expect(component.isWithheld(2)).toBe(true);
        const cleanup = deferredAck();
        const cleanupStarted = deferredAck();
        volume.mockImplementationOnce(() => {
            cleanupStarted.confirm();
            return cleanup.promise;
        });
        unmute.confirm();
        await cleanupStarted.promise;
        expect(volume.mock.calls).toEqual([
            ['session-1', 0],
            ['session-2', 0.5],
            ['session-2', 0],
        ]);
        cleanup.confirm();
        expect(await pending).toBe(false);
        await component.close(2);
        expect(volume.mock.lastCall).toEqual(['session-1', 0.5]);
    });

    it('serializes 2-to-3 audio handoff while keeping window four controls selected', async () => {
        const second = await choose(2);
        expect(await component.swap()).toBe(true);
        const third = await choose(3);
        await choose(4);
        component.selectControls(4);
        volume.mockClear();
        const muted = deferredAck();
        volume.mockReturnValueOnce(muted.promise);
        const pending = component.selectSound(3);
        expect(component.busy()).toBe(true);
        expect(component.audioController()).toBeUndefined();
        expect(component.audioSlot()).toBe(2);
        expect(await component.selectSound(4)).toBe(false);
        expect(volume.mock.calls).toEqual([['session-2', 0]]);
        muted.confirm();
        expect(await pending).toBe(true);
        expect(component.controlsSlot()).toBe(4);
        expect(component.audioController()).toBe(third.controller);
        expect(second.controller.sessionId()).toBe('session-2');
        expect(volume.mock.calls).toEqual([
            ['session-2', 0],
            ['session-3', 0.5],
        ]);
    });

    it('invalidates a handoff when its incoming session ID changes', async () => {
        const second = await choose(2);
        const muted = deferredAck();
        volume.mockReturnValueOnce(muted.promise);
        const pending = component.swap();
        second.controller.sessionId.set('replacement-session');
        muted.confirm();
        expect(await pending).toBe(false);
        expect(component.audioSlot()).toBe(1);
        expect(volume.mock.calls).toEqual([
            ['session-1', 0],
            ['session-1', 0.5],
        ]);
    });

    it('restores only the previous owner if an incoming unmute fails', async () => {
        await choose(2);
        volume
            .mockResolvedValueOnce(null)
            .mockRejectedValueOnce(new Error('helper stopped'));
        expect(await component.swap()).toBe(false);
        expect(component.audioSlot()).toBe(1);
        expect(component.error()).toBe(true);
        expect(volume.mock.calls).toEqual([
            ['session-1', 0],
            ['session-2', 0.5],
            ['session-1', 0.5],
        ]);
    });

    it('serializes exit with handoff, leaving the same primary mounted', async () => {
        await choose(2);
        const muted = deferredAck();
        volume.mockReturnValueOnce(muted.promise);
        const pending = component.swap();
        const exiting = component.close();
        muted.confirm();
        expect(await pending).toBe(false);
        await exiting;
        expect(component.audioSlot()).toBe(1);
        expect(component.layout()).toBe('single');
        expect(first.controller.sessionId()).toBe('session-1');
        expect(volume.mock.calls).toEqual([
            ['session-1', 0],
            ['session-1', 0.5],
        ]);
    });

    it('restores the pre-handoff gain if the outgoing companion closes during mute', async () => {
        const second = await choose(2);
        expect(await component.swap()).toBe(true);
        await choose(3);
        second.controller.session.update(
            (session) => session && { ...session, volume: 0.5 }
        );
        volume.mockClear();
        const muted = deferredAck();
        volume.mockReturnValueOnce(muted.promise);
        const moving = component.selectSound(3);
        const closing = component.close(2);
        second.controller.session.update(
            (session) => session && { ...session, volume: 0 }
        );
        muted.confirm();

        expect(await moving).toBe(false);
        await closing;
        expect(volume.mock.calls).toEqual([
            ['session-2', 0],
            ['session-2', 0],
            ['session-1', 0.5],
        ]);
    });

    it('keeps an ended owner muted when sound moves to the primary', async () => {
        const second = await choose(2);
        expect(await component.swap()).toBe(true);
        second.controller.session.update(
            (session) => session && { ...session, status: 'ended', volume: 0 }
        );
        volume.mockClear();

        expect(await component.swap()).toBe(true);
        expect(volume.mock.calls).toEqual([
            ['session-2', 0],
            ['session-1', 0],
        ]);
    });

    it('retains a zero audible gain across handoff and owner retry', async () => {
        first.controller.session.update(
            (state) => state && { ...state, volume: 0 }
        );
        const second = await choose(2);
        expect(await component.swap()).toBe(true);
        expect(component.audibleVolume()).toBe(0);
        second.controller.session.set(null);
        TestBed.tick();
        expect(component.audibleVolume()).toBe(0);
        Object.defineProperty(second, 'retryEnabled', { value: signal(false) });
        const retry = jest.spyOn(second.controller, 'retry');
        second.retry();
        expect(retry).not.toHaveBeenCalled();
        expect(volume.mock.calls).toEqual([
            ['session-1', 0],
            ['session-2', 0],
        ]);
    });

    it('closes a failed audible companion without restarting the primary', async () => {
        await choose(2);
        await component.swap();
        volume.mockClear().mockRejectedValueOnce(new Error('helper closed'));
        await component.close();
        expect(component.active()).toBe(false);
        expect(component.audioSlot()).toBe(1);
        expect(first.controller.sessionId()).toBe('session-1');
        expect(volume).not.toHaveBeenCalledWith('session-1', expect.anything());
    });

    it('restores the latest acknowledged owner gain when closing it', async () => {
        const second = await choose(2);
        await component.swap();
        volume.mockClear();
        second.controller.session.update(
            (session) => session && { ...session, volume: 0.25 }
        );
        await component.close(2);
        expect(volume.mock.calls).toEqual([
            ['session-2', 0],
            ['session-1', 0.25],
        ]);
    });
});

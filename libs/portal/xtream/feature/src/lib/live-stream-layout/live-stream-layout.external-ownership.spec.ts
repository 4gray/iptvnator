import { TestBed } from '@angular/core/testing';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import {
    epgItem,
    playlist,
    sampleChannel,
} from './live-stream-layout-stubs.spec-data';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';

describe('LiveStreamLayoutComponent external playlist ownership', () => {
    const {
        emptyList,
        epgItems,
        onChannelChange,
        portalPlayer,
        publishExternalSession,
        restoreElectron,
        xtreamStore,
    } = setupLiveStreamLayoutNativeFixture();

    afterEach(restoreElectron);

    it('opens the selected channel when another playlist has the same stream ID pending', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(sampleChannel, true);
        publishExternalSession({
            id: 'synthetic-original',
            player: 'mpv',
            status: 'opened',
            title: 'Synthetic Channel',
            streamUrl: component.activeStreamUrl(),
            canClose: true,
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        });
        fixture.detectChanges();

        xtreamStore.currentPlaylist.set({ ...playlist, id: 'synthetic-other' });
        fixture.detectChanges();
        const other = { ...sampleChannel, xtream_id: 202, category_id: 1 };
        xtreamStore.openPlayer.mockReturnValueOnce(
            new Promise(() => undefined)
        );
        component.playLive(other, true);
        fixture.detectChanges();

        const local = { ...other, category_id: 2 };
        xtreamStore.currentPlaylist.set(playlist);
        xtreamStore.getCategoriesBySelectedType.update((categories) => [
            ...categories,
            { category_id: 2, category_name: 'Synthetic Group' },
        ]);
        emptyList.set([sampleChannel, local]);
        fixture.detectChanges();
        component.guide.open();
        fixture.detectChanges();
        expect(component.guide.isOpen()).toBe(true);
        const source = fixture.debugElement.injector.get(
            XtreamEpgGuideSourceService
        );
        source.setScope('all');
        source.activate(String(local.xtream_id));

        expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(
            local,
            expect.any(Function)
        );
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
    });

    it.each(['loaded', 'timed out'] as const)(
        'keeps an acknowledged switch pending until its requested media is %s',
        async (outcome) => {
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            const first = { ...sampleChannel, category_id: 1 };
            const next = { ...first, xtream_id: 202 };
            emptyList.set([first, next]);
            portalPlayer.isEmbeddedPlayer.set(false);
            fixture.detectChanges();
            component.playLive(first, true);
            const current = {
                id: 'synthetic-current',
                player: 'mpv',
                status: 'opened',
                title: 'Synthetic Channel',
                streamUrl: component.activeStreamUrl(),
                canClose: true,
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
            } as const;
            publishExternalSession(current);
            fixture.detectChanges();
            component.guide.open();
            fixture.detectChanges();
            const source = fixture.debugElement.injector.get(
                XtreamEpgGuideSourceService
            );
            source.setScope('all');

            const failed = jest.fn();
            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.test/failed.ts'
            );
            xtreamStore.openPlayer.mockRejectedValueOnce(
                new Error('Synthetic launch failed')
            );
            source.activate('202', null, undefined, failed);
            await fixture.whenStable();
            expect(failed).not.toHaveBeenCalled();
            expect(component.guide.isOpen()).toBe(true);
            expect(source.scopeId()).toBe('all');

            const committed = jest.fn();
            const nextUrl = 'https://example.test/confirmed.ts';
            xtreamStore.constructStreamUrl.mockReturnValueOnce(nextUrl);
            xtreamStore.openPlayer.mockImplementationOnce(
                () => new Promise(() => undefined)
            );
            source.activate('202');
            source.activate('202', null, undefined, committed);
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
            publishExternalSession(current);
            fixture.detectChanges();
            expect(committed).not.toHaveBeenCalled();
            const replacement = {
                ...current,
                id: 'synthetic-confirmed',
                streamUrl: nextUrl,
            };
            publishExternalSession({ ...replacement, mediaLoaded: false });
            fixture.detectChanges();
            expect(committed).not.toHaveBeenCalled();
            expect(source.activeChannelId()).toBe(String(first.xtream_id));
            if (outcome === 'timed out') {
                publishExternalSession({
                    ...replacement,
                    mediaLoaded: false,
                    playbackUnverified: true,
                });
                fixture.detectChanges();
                expect(component.guide.isOpen()).toBe(true);
                expect(committed).not.toHaveBeenCalled();
                source.activate('202');
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(4);
                return;
            }
            publishExternalSession({ ...replacement, mediaLoaded: true });
            fixture.detectChanges();
            expect(committed).toHaveBeenCalledTimes(1);
        }
    );

    it('cancels an exact pending launch when committing the still-playing channel', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const playing = { ...sampleChannel, category_id: 1 };
        const next = { ...playing, xtream_id: 202 };
        emptyList.set([playing, next]);
        portalPlayer.isEmbeddedPlayer.set(false);
        const nativeClose = jest.fn(() => new Promise(() => undefined));
        Object.defineProperty(window.electron, 'closeExternalPlayerSession', {
            value: nativeClose,
        });
        fixture.detectChanges();
        component.playLive(playing, true);
        const current = {
            id: 'synthetic-playing',
            player: 'mpv',
            status: 'opened',
            mediaLoaded: true,
            title: 'Synthetic Playing Channel',
            streamUrl: component.activeStreamUrl(),
            canClose: true,
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        } as const;
        publishExternalSession(current);
        fixture.detectChanges();
        component.guide.open();
        fixture.detectChanges();
        const source = fixture.debugElement.injector.get(
            XtreamEpgGuideSourceService
        );
        const nextUrl = 'https://example.test/synthetic-next.ts';
        xtreamStore.constructStreamUrl.mockReturnValueOnce(nextUrl);
        xtreamStore.openPlayer.mockImplementationOnce(
            () => new Promise(() => undefined)
        );
        source.activate('202');
        const commit = jest.fn();
        source.activate(String(playing.xtream_id), null, undefined, commit);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);

        publishExternalSession({
            ...current,
            id: 'synthetic-late-replacement',
            streamUrl: nextUrl,
            title: 'Synthetic Replacement',
        });
        fixture.detectChanges();
        expect(nativeClose).toHaveBeenCalledWith(
            'synthetic-late-replacement',
            true
        );
        expect(component.guideNowPlayingChannel()).toBe(current.title);
        expect(source.activeChannelId()).toBe(String(playing.xtream_id));
    });

    it('keeps a socketless MPV guide available without confirming a committed row', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const playing = { ...sampleChannel, category_id: 1 };
        emptyList.set([playing]);
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(playing, true);
        const current = {
            id: 'synthetic-socketless',
            player: 'mpv',
            status: 'opened',
            mediaLoaded: false,
            playbackUnverified: true,
            title: 'Synthetic Channel',
            streamUrl: component.activeStreamUrl(),
            canClose: true,
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        } as const;
        publishExternalSession(current);
        fixture.detectChanges();
        expect(component.guide.available()).toBe(true);
        component.guide.open();
        fixture.detectChanges();
        const source = fixture.debugElement.injector.get(
            XtreamEpgGuideSourceService
        );
        expect(source.activeChannelId()).toBeNull();
        const committed = jest.fn();
        source.activate(String(playing.xtream_id), null, undefined, committed);
        publishExternalSession({ ...current, id: 'synthetic-next-socketless' });
        fixture.detectChanges();
        expect(component.guide.isOpen()).toBe(true);
        expect(committed).not.toHaveBeenCalled();
    });

    it('returns to live when tuning within a one-channel archive queue', async () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const channel = { ...sampleChannel, category_id: 1 };
        emptyList.set([channel]);
        xtreamStore.selectedItem.set(channel);
        epgItems.set([epgItem('Synthetic Archive', 0, 1)]);
        fixture.detectChanges();
        component.playLive(channel, true, [channel]);
        fixture.detectChanges();
        await component.onProgramActivated({
            type: 'timeshift',
            program: component.controlledEpgPrograms()[0],
        });
        fixture.detectChanges();
        expect(component.activeStreamUrl()).toBe(
            'https://example.com/timeshift.ts'
        );
        const calls = xtreamStore.constructStreamUrl.mock.calls.length;
        onChannelChange.mock.lastCall?.[0]({ direction: 'up' });
        fixture.detectChanges();
        expect(component.activeStreamUrl()).toBe('https://example.com/live.ts');
        onChannelChange.mock.lastCall?.[0]({ direction: 'down' });
        expect(xtreamStore.constructStreamUrl).toHaveBeenCalledTimes(calls + 1);
    });
});

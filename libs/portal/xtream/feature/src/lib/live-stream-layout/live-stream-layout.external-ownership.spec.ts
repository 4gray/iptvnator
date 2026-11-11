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
        onRemoteControlCommand,
        portalPlayer,
        publishExternalSession,
        restoreElectron,
        updateRemoteControlStatus,
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
            undefined,
            false
        );
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
    });

    it.each(['loaded', 'timed out', 'unverified VLC'] as const)(
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
                player:
                    outcome === 'unverified VLC'
                        ? ('vlc' as const)
                        : current.player,
                id: 'synthetic-confirmed',
                streamUrl: nextUrl,
            };
            publishExternalSession({ ...replacement, mediaLoaded: false });
            fixture.detectChanges();
            expect(committed).not.toHaveBeenCalled();
            expect(source.activeChannelId()).toBe(String(first.xtream_id));
            if (outcome !== 'loaded') {
                publishExternalSession({
                    ...replacement,
                    mediaLoaded: false,
                    playbackUnverified: true,
                });
                fixture.detectChanges();
                expect(component.guide.isOpen()).toBe(true);
                expect(source.activeChannelId()).toBe(String(first.xtream_id));
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

    it('cancels every pending launch when committing the still-playing channel', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const playing = { ...sampleChannel, category_id: 1 };
        const next = { ...playing, xtream_id: 202 };
        const last = { ...playing, xtream_id: 203 };
        emptyList.set([playing, next, last]);
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
        const pending = [next, last].map((item) => ({
            id: `synthetic-late-${item.xtream_id}`,
            url: `https://example.test/synthetic-${item.xtream_id}.ts`,
            row: String(item.xtream_id),
        }));
        for (const { row, url } of pending) {
            xtreamStore.constructStreamUrl.mockReturnValueOnce(url);
            xtreamStore.openPlayer.mockImplementationOnce(
                () => new Promise(() => undefined)
            );
            source.activate(row);
        }
        publishExternalSession({
            ...current,
            id: pending[0].id,
            streamUrl: pending[0].url,
            mediaLoaded: false,
            playbackUnverified: true,
        });
        fixture.detectChanges();
        const commit = jest.fn();
        source.activate(String(playing.xtream_id), null, undefined, commit);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
        for (const { id, url } of pending) {
            publishExternalSession({
                ...current,
                id,
                streamUrl: url,
                title: 'Synthetic Replacement',
            });
            fixture.detectChanges();
            expect(nativeClose).toHaveBeenCalledWith(id, true);
        }
        expect(nativeClose).toHaveBeenCalledTimes(2);
        expect(component.guideNowPlayingChannel()).toBe(current.title);
        expect(source.activeChannelId()).toBe(String(playing.xtream_id));
    });

    it('keeps the confirmed panel selected when the guide closes during a switch', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const playing = { ...sampleChannel, category_id: 1 };
        const next = { ...playing, xtream_id: 202 };
        emptyList.set([playing, next]);
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(playing, true);
        const current = {
            id: 'synthetic-confirmed-panel',
            player: 'mpv',
            status: 'opened',
            mediaLoaded: true,
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
        const nextUrl = 'https://example.test/synthetic-next.ts';
        xtreamStore.constructStreamUrl.mockReturnValueOnce(nextUrl);
        xtreamStore.openPlayer.mockImplementationOnce(
            () => new Promise(() => undefined)
        );
        source.activate(String(next.xtream_id));
        expect(xtreamStore.openPlayer.mock.lastCall?.[0]).toBe(nextUrl);
        expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(
            next,
            undefined,
            false
        );
        component.guide.close();
        fixture.detectChanges();
        expect(component.activeStreamUrl()).toBe(current.streamUrl);
        expect(xtreamStore.setSelectedItem).not.toHaveBeenCalledWith(next);

        publishExternalSession({
            ...current,
            id: 'synthetic-new-panel',
            streamUrl: nextUrl,
        });
        fixture.detectChanges();
        expect(component.activeStreamUrl()).toBe(nextUrl);
        expect(xtreamStore.setSelectedItem).toHaveBeenLastCalledWith(next);
    });

    it.each(['mpv', 'vlc'] as const)(
        'retains remote tuning after %s goes idle',
        (player) => {
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            const playing = { ...sampleChannel, category_id: 1 };
            const next = { ...playing, xtream_id: playing.xtream_id + 1 };
            emptyList.set([playing, next]);
            portalPlayer.isEmbeddedPlayer.set(false);
            fixture.detectChanges();
            component.playLive(playing, true, [playing, next]);
            const session = {
                id: 'synthetic-idle',
                player,
                status: 'opened',
                mediaLoaded: true,
                title: 'Synthetic Channel',
                streamUrl: component.activeStreamUrl(),
                canClose: true,
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
            } as const;
            publishExternalSession(session);
            fixture.detectChanges();
            publishExternalSession({ ...session, playbackIdle: true });
            fixture.detectChanges();

            expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    isLiveView: true,
                    channelName: undefined,
                    channelNumber: undefined,
                })
            );
            expect(component.guideNowPlayingChannel()).toBe('');
            onChannelChange.mock.lastCall?.[0]({ direction: 'up' });
            expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(
                next
            );
        }
    );

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

    it('keeps the socketless MPV remote queue for arrows and numeric tuning', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const playing = { ...sampleChannel, category_id: 1 };
        const next = {
            ...playing,
            xtream_id: playing.xtream_id + 1,
            name: 'Synthetic Next',
        };
        emptyList.set([playing, next]);
        xtreamStore.selectedItem.set(playing);
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(playing, true, [playing, next]);
        publishExternalSession({
            id: 'synthetic-remote-socketless',
            player: 'mpv',
            status: 'opened',
            mediaLoaded: false,
            playbackUnverified: true,
            mediaObservationUnavailable: true,
            title: 'Synthetic Channel',
            streamUrl: component.activeStreamUrl(),
            canClose: true,
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        });
        fixture.detectChanges();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({ isLiveView: true, channelNumber: 1 })
        );
        expect(component.guideNowPlayingChannel()).toBe('');
        onChannelChange.mock.lastCall?.[0]({ direction: 'up' });
        expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(next);
        onRemoteControlCommand.mock.lastCall?.[0]({
            type: 'channel-select-number',
            number: 1,
        });
        expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(
            playing
        );
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

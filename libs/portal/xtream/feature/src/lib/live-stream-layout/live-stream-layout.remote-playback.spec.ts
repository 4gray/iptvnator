import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EpgPreferencesService } from '@iptvnator/services';
import {
    XtreamApiService,
    XtreamFullEpgService,
} from '@iptvnator/portal/xtream/data-access';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import {
    epgItem,
    sampleChannel,
    StubWebPlayerViewComponent,
} from './live-stream-layout-stubs.spec-data';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';
import { XtreamLiveChannelNavigationService } from './xtream-live-channel-navigation.service';

describe('Xtream remote playback metadata', () => {
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

    it('retries the only inline channel on a remote step after playback fails', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const channel = { ...sampleChannel, category_id: 1 };
        emptyList.set([channel]);
        xtreamStore.selectedItem.set(channel);
        component.playLive(channel, true, [channel]);
        fixture.detectChanges();
        const player = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        ).componentInstance as StubWebPlayerViewComponent;
        onChannelChange.mock.lastCall?.[0]({ direction: 'down' });
        expect(player.retryFailedPlayback).toHaveBeenCalledTimes(1);
        expect(xtreamStore.constructStreamUrl).toHaveBeenCalledTimes(1);
        player.retryFailedPlayback.mockReturnValueOnce(true);
        onChannelChange.mock.lastCall?.[0]({ direction: 'up' });
        expect(player.retryFailedPlayback).toHaveBeenCalledTimes(2);
        expect(component.activeStreamUrl()).toBe(player.streamUrl());
        expect(xtreamStore.constructStreamUrl).toHaveBeenCalledTimes(1);
    });

    it('keeps the latest playing schedule on the remote when previewing another channel', async () => {
        const now = Math.floor(Date.now() / 1000);
        const start = new Date((now - 60) * 1000).toISOString();
        const stop = new Date((now + 60) * 1000).toISOString();
        const airing = {
            ...epgItem('Synthetic Playing Programme', 0, 1),
            start,
            stop,
            end: stop,
            start_timestamp: String(now - 60),
            stop_timestamp: String(now + 60),
        };
        const guideAiring = { ...airing, title: 'Synthetic Guide Programme' };
        const load = jest.fn(async () => [guideAiring]);
        TestBed.overrideProvider(XtreamFullEpgService, { useValue: { load } });
        TestBed.overrideProvider(XtreamApiService, {
            useValue: { cancelSession: jest.fn() },
        });
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const playing = {
            ...sampleChannel,
            category_id: 1,
            name: 'Synthetic Playing',
        };
        const preview = {
            ...playing,
            xtream_id: playing.xtream_id + 1,
            name: 'Synthetic Preview',
        };
        emptyList.set([playing, preview]);
        epgItems.set([airing]);
        xtreamStore.selectedItem.set(playing);
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(playing, true);
        publishExternalSession({
            id: 'synthetic-confirmed',
            player: 'mpv',
            status: 'playing',
            mediaLoaded: true,
            canClose: true,
            title: playing.name,
            streamUrl: component.activeStreamUrl(),
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        });
        fixture.detectChanges();
        component.playLive(preview, false);
        xtreamStore.selectedItem.set(preview);
        epgItems.set([{ ...airing, title: 'Synthetic Preview Programme' }]);
        fixture.detectChanges();
        const expectRemoteProgramme = (title: string) =>
            expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    channelName: playing.name,
                    epgTitle: title,
                })
            );
        expectRemoteProgramme(airing.title);
        component.guide.open();
        fixture.detectChanges();
        const source = fixture.debugElement.injector.get(
            XtreamEpgGuideSourceService
        );
        await source.playbackSchedule(playing);
        fixture.detectChanges();
        expectRemoteProgramme(guideAiring.title);
        component.guide.close();
        fixture.detectChanges();
        expectRemoteProgramme(guideAiring.title);
        const refreshed = { ...airing, title: 'Synthetic Refreshed Programme' };
        xtreamStore.selectedItem.set(playing);
        epgItems.set([refreshed]);
        fixture.detectChanges();
        expectRemoteProgramme(refreshed.title);
        xtreamStore.selectedItem.set(preview);
        epgItems.set([{ ...airing, title: 'Synthetic Preview Programme' }]);
        fixture.detectChanges();
        expectRemoteProgramme(refreshed.title);
        xtreamStore.selectedItem.set(playing);
        epgItems.set([refreshed]);
        load.mockReturnValueOnce(new Promise(() => undefined));
        component.guide.open();
        fixture.detectChanges();
        expect(epgItems()).toEqual([refreshed]);
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])(
        'keeps remote tuning available during a local or remote launch (%s)',
        (firstIsPending) => {
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            const first = { ...sampleChannel, category_id: 1 };
            const second = { ...first, xtream_id: first.xtream_id + 1 };
            const third = { ...first, xtream_id: first.xtream_id + 2 };
            const queue = [first, second, third];
            emptyList.set(queue);
            portalPlayer.isEmbeddedPlayer.set(false);
            fixture.detectChanges();
            if (firstIsPending)
                xtreamStore.openPlayer.mockImplementationOnce(
                    () => new Promise(() => undefined)
                );
            component.playLive(first, true, queue);
            const session = {
                id: 'synthetic-first',
                player: 'mpv',
                status: firstIsPending ? 'launching' : 'opened',
                canClose: true,
                reuseAvailable: true,
                mediaLoaded: !firstIsPending,
                title: 'Synthetic First',
                streamUrl: component.activeStreamUrl(),
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
            } as const;
            publishExternalSession(session);
            fixture.detectChanges();
            if (firstIsPending)
                expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        isLiveView: true,
                        channelName: undefined,
                        channelNumber: undefined,
                        epgTitle: undefined,
                    })
                );
            const secondUrl = 'https://example.test/synthetic-second.ts';
            xtreamStore.constructStreamUrl.mockReturnValueOnce(secondUrl);
            xtreamStore.openPlayer.mockImplementationOnce(
                () => new Promise(() => undefined)
            );
            onChannelChange.mock.lastCall?.[0]({ direction: 'down' });
            publishExternalSession({
                ...session,
                status: 'closed',
                canClose: false,
            });
            publishExternalSession({
                ...session,
                id: 'synthetic-second',
                streamUrl: secondUrl,
                status: 'launching',
                mediaLoaded: false,
            });
            fixture.detectChanges();
            expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    isLiveView: true,
                    channelName: undefined,
                    channelNumber: undefined,
                    epgTitle: undefined,
                })
            );
            const thirdUrl = 'https://example.test/synthetic-third.ts';
            const tuneCall =
                xtreamStore.constructStreamUrl.mock.calls.length + 1;
            xtreamStore.constructStreamUrl.mockReturnValueOnce(thirdUrl);
            onChannelChange.mock.lastCall?.[0]({ direction: 'down' });
            expect(xtreamStore.constructStreamUrl).toHaveBeenNthCalledWith(
                tuneCall,
                third
            );
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
            expect(xtreamStore.openPlayer.mock.lastCall?.[0]).toBe(thirdUrl);
        }
    );

    it('returns from an unverified archive using its saved queue without publishing its programme', async () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const original = { ...sampleChannel, category_id: 1 };
        const channel = { ...original, xtream_id: original.xtream_id + 1 };
        const preview = { ...channel, xtream_id: channel.xtream_id + 1 };
        const queue = [channel, preview];
        emptyList.set([original, ...queue]);
        xtreamStore.selectedItem.set(original);
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(original, true, [original]);
        const prior = {
            id: 'synthetic-survivor',
            player: 'mpv',
            status: 'opened',
            streamUrl: component.activeStreamUrl(),
            title: 'Synthetic Survivor',
            canClose: true,
            reuseAvailable: false,
            mediaLoaded: true,
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        } as const;
        publishExternalSession(prior);
        fixture.detectChanges();
        component.playLive(channel, false, queue);
        xtreamStore.selectedItem.set(channel);
        epgItems.set([epgItem('Synthetic Archive', 0, 1)]);
        xtreamStore.openPlayer.mockReturnValueOnce(
            new Promise(() => undefined)
        );
        await component.onProgramActivated({
            type: 'timeshift',
            program: component.controlledEpgPrograms()[0],
        });
        const streamUrl = xtreamStore.openPlayer.mock.lastCall?.[0] as string;
        const archive = {
            ...prior,
            id: 'synthetic-archive',
            streamUrl,
            title: 'Synthetic Archive',
            canClose: true,
            mediaLoaded: false,
            playbackUnverified: true,
            mediaObservationUnavailable: true,
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        } as const;
        publishExternalSession(archive);
        xtreamStore.selectedItem.set(preview);
        fixture.detectChanges();
        expect(component.showReturnToLive()).toBe(true);
        expect(component.guideNowPlayingProgram()).toBeNull();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({ isLiveView: true, epgTitle: undefined })
        );
        Object.defineProperty(window.electron, 'closeExternalPlayerSession', {
            value: async (id: string) => {
                const closing = id === prior.id ? prior : archive;
                const closed = {
                    ...closing,
                    status: 'closed' as const,
                    canClose: false,
                    closedByRequest: true as const,
                };
                publishExternalSession(closed);
                return closed;
            },
            configurable: true,
        });
        const liveUrl = 'https://example.test/synthetic-return.ts';
        xtreamStore.constructStreamUrl.mockReturnValueOnce(liveUrl);
        component.returnToLivePlayback();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(xtreamStore.openPlayer.mock.lastCall?.[0]).toBe(liveUrl);
        publishExternalSession({
            ...prior,
            id: 'synthetic-return',
            streamUrl: liveUrl,
        });
        fixture.detectChanges();
        const navigation = fixture.debugElement.injector.get(
            XtreamLiveChannelNavigationService
        );
        expect(navigation.remoteChannels()).toEqual(queue);
    });

    it('keeps an external archive playing but removes its remote programme when EPG is disabled', async () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const channel = { ...sampleChannel, category_id: 1 };
        emptyList.set([channel]);
        xtreamStore.selectedItem.set(channel);
        epgItems.set([epgItem('Synthetic Archive', 0, 1)]);
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(channel, true);
        const live = {
            id: 'synthetic-live',
            player: 'mpv',
            status: 'opened',
            mediaLoaded: true,
            canClose: true,
            title: 'Synthetic Channel',
            streamUrl: component.activeStreamUrl(),
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        } as const;
        publishExternalSession(live);
        fixture.detectChanges();
        xtreamStore.openPlayer.mockImplementationOnce(
            () => new Promise(() => undefined)
        );
        await component.onProgramActivated({
            type: 'timeshift',
            program: component.controlledEpgPrograms()[0],
        });
        const archiveUrl = xtreamStore.openPlayer.mock.lastCall?.[0] as string;
        publishExternalSession({
            ...live,
            id: 'synthetic-archive',
            streamUrl: archiveUrl,
        });
        fixture.detectChanges();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isLiveView: true,
                epgTitle: 'Synthetic Archive',
            })
        );
        await TestBed.inject(EpgPreferencesService).apply(false);
        fixture.detectChanges();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isLiveView: true,
                epgTitle: undefined,
                epgStart: undefined,
                epgEnd: undefined,
            })
        );
        expect(component.activeStreamUrl()).toBe(archiveUrl);
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
    });

    it('keeps the confirmed remote channel and programme together during an unverified MPV launch', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const playing = {
            ...sampleChannel,
            category_id: 1,
            name: 'Synthetic First',
        };
        const next = {
            ...playing,
            xtream_id: playing.xtream_id + 1,
            name: 'Synthetic Next',
        };
        const now = Math.floor(Date.now() / 1000);
        const start = new Date((now - 60) * 1000).toISOString();
        const stop = new Date((now + 60) * 1000).toISOString();
        epgItems.set([
            {
                ...epgItem('Synthetic Programme', 0, 1),
                start,
                stop,
                end: stop,
                start_timestamp: String(now - 60),
                stop_timestamp: String(now + 60),
            },
        ]);
        emptyList.set([playing, next]);
        xtreamStore.selectedItem.set(playing);
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(playing, true, [playing, next]);
        const current = {
            id: 'synthetic-confirmed-detached',
            player: 'mpv',
            status: 'playing',
            mediaLoaded: true,
            title: playing.name,
            streamUrl: component.activeStreamUrl(),
            canClose: true,
            reuseAvailable: false,
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        } as const;
        publishExternalSession(current);
        fixture.detectChanges();
        const confirmedStatus = expect.objectContaining({
            channelName: playing.name,
            channelNumber: 1,
            epgTitle: 'Synthetic Programme',
        });
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            confirmedStatus
        );

        component.guide.open();
        const refreshed = { ...playing, epg_channel_id: 'synthetic.updated' };
        emptyList.set([refreshed, next]);
        xtreamStore.selectedItem.set(refreshed);
        component.guide.close();
        fixture.detectChanges();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            confirmedStatus
        );
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);

        onRemoteControlCommand.mock.lastCall?.[0]({
            type: 'channel-select-number',
            number: 1,
        });
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);
        expect(xtreamStore.addRecentItem).not.toHaveBeenCalled();

        const nextUrl = 'https://example.test/synthetic-other.ts';
        xtreamStore.constructStreamUrl.mockReturnValueOnce(nextUrl);
        component.playLive(next, true, [playing, next]);
        const unverified = {
            ...current,
            id: 'synthetic-unverified-detached',
            streamUrl: nextUrl,
            title: next.name,
            mediaLoaded: false,
            mediaObservationUnavailable: true,
            playbackUnverified: true,
        };
        publishExternalSession(unverified);
        fixture.detectChanges();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            confirmedStatus
        );

        publishExternalSession({
            ...current,
            status: 'closed',
            canClose: false,
        });
        publishExternalSession(unverified);
        fixture.detectChanges();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({
                channelName: next.name,
                channelNumber: 2,
                epgTitle: undefined,
            })
        );
    });
});

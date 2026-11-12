import { TestBed } from '@angular/core/testing';
import {
    XtreamApiService,
    XtreamFullEpgService,
} from '@iptvnator/portal/xtream/data-access';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import { epgItem, sampleChannel } from './live-stream-layout-stubs.spec-data';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';

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

    it('keeps the playing schedule on the remote after closing the guide over another preview', async () => {
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
        const load = jest.fn(async () => [airing]);
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
        const confirmed = expect.objectContaining({
            channelName: playing.name,
            epgTitle: airing.title,
        });
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(confirmed);
        component.guide.open();
        fixture.detectChanges();
        const source = fixture.debugElement.injector.get(
            XtreamEpgGuideSourceService
        );
        await source.playbackSchedule(playing);
        fixture.detectChanges();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(confirmed);
        component.guide.close();
        fixture.detectChanges();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(confirmed);
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);
    });

    it('keeps remote tuning available between the old session and its unconfirmed replacement', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const first = { ...sampleChannel, category_id: 1 };
        const second = { ...first, xtream_id: first.xtream_id + 1 };
        const third = { ...first, xtream_id: first.xtream_id + 2 };
        const queue = [first, second, third];
        emptyList.set(queue);
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(first, true, queue);
        const session = {
            id: 'synthetic-first',
            player: 'mpv',
            status: 'opened',
            canClose: true,
            reuseAvailable: true,
            mediaLoaded: true,
            title: 'Synthetic First',
            streamUrl: component.activeStreamUrl(),
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        } as const;
        publishExternalSession(session);
        fixture.detectChanges();
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
        const tuneCall = xtreamStore.constructStreamUrl.mock.calls.length + 1;
        xtreamStore.constructStreamUrl.mockReturnValueOnce(thirdUrl);
        onChannelChange.mock.lastCall?.[0]({ direction: 'down' });
        expect(xtreamStore.constructStreamUrl).toHaveBeenNthCalledWith(
            tuneCall,
            third
        );
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
        expect(xtreamStore.openPlayer.mock.lastCall?.[0]).toBe(thirdUrl);
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

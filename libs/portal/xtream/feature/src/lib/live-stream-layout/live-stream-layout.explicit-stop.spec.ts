import { TestBed } from '@angular/core/testing';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import { sampleChannel } from './live-stream-layout-stubs.spec-data';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';

describe('Xtream guide Stop during a detached handoff', () => {
    const {
        databaseService,
        emptyList,
        onChannelChange,
        pendingStop,
        player,
        portalPlayer,
        publishExternalSession,
        restoreElectron,
        runtime,
        stopRequested,
        updateRemoteControlStatus,
        xtreamStore,
    } = setupLiveStreamLayoutNativeFixture();

    afterEach(restoreElectron);

    it('clears the older failed tune when the next opening is stopped', async () => {
        const first = { ...sampleChannel, category_id: 1 };
        const second = { ...first, xtream_id: first.xtream_id + 1 };
        const queue = [first, second];
        emptyList.set(queue);
        portalPlayer.isEmbeddedPlayer.set(false);
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        fixture.detectChanges();
        xtreamStore.openPlayer.mockRejectedValueOnce(
            new Error('Synthetic launch failure')
        );
        component.playLive(first, true, queue);
        await Promise.resolve();
        fixture.detectChanges();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({ isLiveView: true })
        );

        const streamUrl = 'https://example.test/synthetic-next.ts';
        xtreamStore.constructStreamUrl.mockReturnValueOnce(streamUrl);
        xtreamStore.openPlayer.mockReturnValueOnce(
            new Promise(() => undefined)
        );
        component.playLive(second, true, queue);
        const pending = {
            id: 'synthetic-next',
            player: 'mpv',
            status: 'launching',
            streamUrl,
            title: 'Synthetic Next',
            canClose: true,
            mediaLoaded: false,
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        } as const;
        publishExternalSession(pending);
        stopRequested.next(pending.id);
        publishExternalSession({
            ...pending,
            status: 'closed',
            canClose: false,
            closedByRequest: true,
        });
        fixture.detectChanges();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({ isLiveView: false })
        );
        onChannelChange.mock.lastCall?.[0]({ direction: 'down' });
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
    });

    it.each(['handoff', 'stop', 'retune'] as const)(
        'orders a detached guide tune and a dock Stop (%s)',
        async (action) => {
            const first = { ...sampleChannel, category_id: 1 };
            const second = { ...first, xtream_id: first.xtream_id + 1 };
            emptyList.set([first, second]);
            portalPlayer.isEmbeddedPlayer.set(false);
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            fixture.detectChanges();
            component.playLive(first, true);
            const current = {
                id: 'synthetic-detached',
                player: 'mpv',
                status: 'playing',
                title: 'Synthetic Channel',
                streamUrl: component.activeStreamUrl(),
                canClose: true,
                reuseAvailable: false,
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
            } as const;
            publishExternalSession(current);
            fixture.detectChanges();
            component.guide.open();
            fixture.detectChanges();
            let finish!: () => void;
            const stopping = new Promise<void>((resolve) => {
                finish = resolve;
            });
            const close = jest.fn(() => stopping);
            Object.defineProperty(
                window.electron,
                'closeExternalPlayerSession',
                { value: close, configurable: true }
            );
            const source = fixture.debugElement.injector.get(
                XtreamEpgGuideSourceService
            );
            xtreamStore.openPlayer.mockReturnValueOnce(
                new Promise(() => undefined)
            );
            const confirmed = jest.fn();
            if (action === 'retune') {
                pendingStop.mockImplementation((id) =>
                    id === current.id ? stopping : undefined
                );
                stopRequested.next(current.id);
                source.activate(
                    String(first.xtream_id),
                    null,
                    undefined,
                    confirmed
                );
                expect(close).not.toHaveBeenCalled();
                expect(confirmed).not.toHaveBeenCalled();
            } else {
                xtreamStore.constructStreamUrl.mockReturnValueOnce(
                    'https://example.test/synthetic-next.ts'
                );
                source.activate(String(second.xtream_id));
                expect(close).toHaveBeenCalledWith(current.id, true);
                if (action === 'stop') stopRequested.next(current.id);
            }
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);
            publishExternalSession({
                ...current,
                status: 'closed',
                canClose: false,
                closedByRequest: true,
            });
            finish();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(
                action === 'stop' ? 1 : 2
            );
            if (action === 'retune') {
                expect(confirmed).not.toHaveBeenCalled();
                publishExternalSession({
                    ...current,
                    id: 'synthetic-restarted',
                    mediaLoaded: true,
                });
                fixture.detectChanges();
                expect(confirmed).toHaveBeenCalledTimes(1);
            }
        }
    );

    it('cancels a tune still resolving its category, then permits a new tune', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        try {
            const first = { ...sampleChannel, category_id: 1 };
            const second = {
                ...first,
                xtream_id: first.xtream_id + 1,
                category_id: 2,
            };
            emptyList.set([first, second]);
            portalPlayer.isEmbeddedPlayer.set(false);
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            fixture.detectChanges();
            component.playLive(first, true);
            const current = {
                id: 'synthetic-category-lookup',
                player: 'mpv',
                status: 'playing',
                title: 'Synthetic Channel',
                streamUrl: component.activeStreamUrl(),
                canClose: true,
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
            } as const;
            publishExternalSession(current);
            fixture.detectChanges();
            let finish!: (rows: unknown[]) => void;
            databaseService.getAllXtreamCategories.mockReturnValueOnce(
                new Promise((resolve) => (finish = resolve))
            );
            component.playLive(second, true);
            expect(
                databaseService.getAllXtreamCategories
            ).toHaveBeenCalledTimes(1);
            stopRequested.next(current.id);
            publishExternalSession({
                ...current,
                status: 'closed',
                canClose: false,
            });
            const categories = [{ id: 2, xtream_id: 22 }];
            finish(categories);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);

            databaseService.getAllXtreamCategories.mockResolvedValueOnce(
                categories
            );
            component.playLive(second, true);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
        } finally {
            runtime.supportsXtreamSqliteDataSource = false;
        }
    });

    it.each([
        'stop',
        'stop-mpv-replacement',
        'stop-vlc-replacement',
        'still-playing',
        'cleared',
        'mpv-replaced',
    ] as const)(
        'waits for the exact dispatched switch when returning to the current player (%s)',
        async (scenario) => {
            const first = { ...sampleChannel, category_id: 1 };
            const second = { ...first, xtream_id: first.xtream_id + 1 };
            emptyList.set([first, second]);
            portalPlayer.isEmbeddedPlayer.set(false);
            const mpv =
                scenario === 'stop' ||
                scenario === 'stop-mpv-replacement' ||
                scenario === 'mpv-replaced';
            const retunes =
                scenario === 'cleared' || scenario === 'mpv-replaced';
            player.set(mpv ? VideoPlayer.MPV : VideoPlayer.VLC);
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            const close = jest.fn(() => new Promise(() => undefined));
            Object.defineProperty(
                window.electron,
                'closeExternalPlayerSession',
                { value: close }
            );
            fixture.detectChanges();
            component.playLive(first, true);
            const current = {
                id: 'synthetic-current',
                player: mpv ? 'mpv' : 'vlc',
                status: 'opened',
                mediaLoaded: true,
                playbackIdle: false,
                canClose: true,
                reuseAvailable: true,
                title: 'Synthetic First',
                streamUrl: component.activeStreamUrl(),
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
            const next = {
                ...current,
                id: 'synthetic-next',
                streamUrl: 'https://example.test/synthetic-next.ts',
            };
            xtreamStore.constructStreamUrl.mockReturnValueOnce(next.streamUrl);
            xtreamStore.openPlayer.mockImplementationOnce(
                () => new Promise(() => undefined)
            );
            source.activate(String(second.xtream_id));
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
            const commit = jest.fn();
            if (scenario.startsWith('stop-')) {
                publishExternalSession({
                    ...next,
                    status: 'launching',
                    mediaLoaded: false,
                });
                stopRequested.next(next.id);
                expect(close).not.toHaveBeenCalled();
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
                return;
            }
            if (scenario === 'stop') {
                stopRequested.next(current.id);
                publishExternalSession({
                    ...current,
                    status: 'closed',
                    canClose: false,
                });
                publishExternalSession(next);
            } else {
                publishExternalSession({
                    ...next,
                    status: 'launching',
                    mediaLoaded: false,
                });
                fixture.detectChanges();
                source.activate(
                    String(first.xtream_id),
                    null,
                    undefined,
                    commit
                );
            }
            expect(close).toHaveBeenCalledWith(next.id, true);
            expect(commit).not.toHaveBeenCalled();
            if (retunes) {
                xtreamStore.openPlayer.mockImplementationOnce(
                    () => new Promise(() => undefined)
                );
                publishExternalSession(
                    scenario === 'cleared'
                        ? {
                              ...current,
                              mediaLoaded: false,
                              playbackUnverified: true,
                          }
                        : { ...current, status: 'closed', canClose: false }
                );
            }
            publishExternalSession({
                ...next,
                status: 'closed',
                canClose: false,
            });
            fixture.detectChanges();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(commit).toHaveBeenCalledTimes(
                scenario === 'still-playing' ? 1 : 0
            );
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(
                retunes ? 3 : 2
            );
            if (retunes) {
                publishExternalSession({ ...current, id: 'synthetic-retuned' });
                fixture.detectChanges();
                expect(commit).toHaveBeenCalledTimes(1);
            }
        }
    );
});

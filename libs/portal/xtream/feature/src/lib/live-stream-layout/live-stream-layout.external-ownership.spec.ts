import { TestBed } from '@angular/core/testing';
import { XtreamUrlService } from '@iptvnator/portal/xtream/data-access';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import {
    epgItem,
    playlist,
    sampleChannel,
} from './live-stream-layout-stubs.spec-data';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';
import { XtreamLiveChannelNavigationService } from './xtream-live-channel-navigation.service';

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

    it.each([true, false])(
        'switches EPG copies without restarting playback (embedded: %s)',
        (embedded) => {
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            fixture.detectChanges();
            const playing = {
                ...sampleChannel,
                category_id: 1,
                epg_channel_id: 'synthetic.first',
            };
            const copy = {
                ...playing,
                category_id: 2,
                epg_channel_id: 'synthetic.copy',
            };
            const hidden = { ...playing, xtream_id: 102, category_id: 3 };
            const categories = xtreamStore.getCategoriesBySelectedType();
            const visible = [
                ...categories,
                { category_id: 2, category_name: 'Synthetic Copy Group' },
            ];
            const all = [
                ...visible,
                { category_id: 3, category_name: 'Synthetic Queue Group' },
            ];
            xtreamStore.getCategoriesBySelectedType.set(all);
            try {
                emptyList.set([playing, copy, hidden]);
                portalPlayer.isEmbeddedPlayer.set(embedded);
                component.playLive(playing, true, [playing, hidden]);
                const playback = component.activePlayback()!;
                if (!embedded)
                    publishExternalSession({
                        id: 'synthetic-copy-switch-session',
                        streamUrl: playback.streamUrl,
                        title: 'Synthetic Channel',
                        player: 'mpv',
                        status: 'playing',
                        startedAt: '2026-04-04T10:00:00Z',
                        updatedAt: '2026-04-04T10:00:00Z',
                        canClose: true,
                    });
                component.guide.open();
                fixture.detectChanges();
                const source = fixture.debugElement.injector.get(
                    XtreamEpgGuideSourceService
                );
                const navigation = fixture.debugElement.injector.get(
                    XtreamLiveChannelNavigationService
                );
                xtreamStore.getCategoriesBySelectedType.set(visible);
                fixture.detectChanges();
                expect(navigation.remoteChannels()).toEqual([playing]);
                expect(source.activeChannelId()).toBe('101');
                source.setScope('2');
                expect(source.activeChannelId()).toBeNull();
                source.activate('101');
                fixture.detectChanges();
                expect(source.activeChannelId()).toBe('101');
                expect(source.playingItem()).toBe(copy);
                expect(component.activePlayback()).toBe(playback);
                expect(xtreamStore.setSelectedItem).toHaveBeenLastCalledWith(
                    copy
                );
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(
                    embedded ? 0 : 1
                );
                xtreamStore.getCategoriesBySelectedType.set(all);
                expect(navigation.remoteChannels()).toEqual([copy, hidden]);
            } finally {
                xtreamStore.getCategoriesBySelectedType.set(categories);
            }
        }
    );

    it('does not launch an archive resolved after editing the connection', async () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        portalPlayer.isEmbeddedPlayer.set(false);
        epgItems.set([epgItem('Synthetic Archive', 0, 1)]);
        fixture.detectChanges();
        component.playLive(sampleChannel, true);
        const previous = component.activeStreamUrl();
        const resolveCatchupUrl = jest.mocked(
            TestBed.inject(XtreamUrlService).resolveCatchupUrl
        );
        let resolve!: (url: string) => void;
        resolveCatchupUrl.mockReturnValueOnce(
            new Promise((done) => {
                resolve = done;
            })
        );
        const opening = component.onProgramActivated({
            type: 'timeshift',
            program: component.controlledEpgPrograms()[0],
        });
        expect(resolveCatchupUrl).toHaveBeenCalled();
        xtreamStore.currentPlaylist.set({
            ...playlist,
            serverUrl: 'https://another.example.test',
        });
        resolve('https://example.test/synthetic-archive.ts');
        await opening;
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);
        expect(component.activeStreamUrl()).toBe(previous);
    });

    it.each([
        { serverUrl: 'https://another.example.test' },
        { username: 'synthetic-other-user' },
        { password: 'synthetic-other-secret' },
    ])(
        'does not reattach a live session after editing its connection (%j)',
        (edit) => {
            const first = TestBed.createComponent(LiveStreamLayoutComponent);
            portalPlayer.isEmbeddedPlayer.set(false);
            first.detectChanges();
            first.componentInstance.playLive(sampleChannel, true);
            publishExternalSession({
                id: 'synthetic-original',
                player: 'mpv',
                status: 'opened',
                title: 'Synthetic Channel',
                streamUrl: first.componentInstance.activeStreamUrl(),
                canClose: true,
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
            });
            first.detectChanges();
            expect(first.componentInstance.guide.available()).toBe(true);
            first.destroy();
            xtreamStore.currentPlaylist.set({ ...playlist, ...edit });
            const second = TestBed.createComponent(LiveStreamLayoutComponent);
            second.detectChanges();
            expect(second.componentInstance.guide.available()).toBe(false);
            expect(second.componentInstance.guideNowPlayingChannel()).toBe('');
        }
    );

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

    it.each([
        'loaded',
        'timed out',
        'unverified VLC',
        'VLC timed out',
    ] as const)(
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
                player: outcome.includes('VLC')
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
                    mediaReadinessTimedOut:
                        outcome === 'VLC timed out' || undefined,
                });
                fixture.detectChanges();
                expect(component.guide.isOpen()).toBe(true);
                expect(source.activeChannelId()).toBe(String(first.xtream_id));
                expect(committed).not.toHaveBeenCalled();
                source.activate('202');
                if (outcome !== 'unverified VLC') {
                    expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(4);
                    return;
                }
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
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

    it.each([
        'mpv',
        'vlc',
        'first MPV failure',
        'native error',
        'unexpected clean exit',
        'explicit stop',
        'closable error then Stop',
        'rejected invocation',
    ] as const)(
        'keeps remote tuning after %s unless Stop was requested',
        async (outcome) => {
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            const playing = { ...sampleChannel, category_id: 1 };
            const next = { ...playing, xtream_id: playing.xtream_id + 1 };
            emptyList.set([playing, next]);
            portalPlayer.isEmbeddedPlayer.set(false);
            fixture.detectChanges();
            const errorThenStop = outcome === 'closable error then Stop';
            const terminal =
                errorThenStop ||
                [
                    'native error',
                    'unexpected clean exit',
                    'explicit stop',
                ].includes(outcome);
            if (outcome === 'rejected invocation')
                xtreamStore.openPlayer.mockRejectedValueOnce(
                    new Error('Synthetic player failed')
                );
            else if (terminal)
                xtreamStore.openPlayer.mockReturnValueOnce(
                    new Promise(() => undefined)
                );
            component.playLive(playing, true, [playing, next]);
            const session = {
                id: 'synthetic-idle',
                player: outcome === 'vlc' ? 'vlc' : 'mpv',
                status: 'opened',
                mediaLoaded: outcome !== 'first MPV failure',
                title: 'Synthetic Channel',
                streamUrl: component.activeStreamUrl(),
                canClose: true,
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
            } as const;
            if (terminal) {
                publishExternalSession({
                    ...session,
                    launchId: xtreamStore.openPlayer.mock.lastCall?.[5],
                    status:
                        outcome === 'native error' || errorThenStop
                            ? 'error'
                            : 'closed',
                    closedByRequest:
                        outcome === 'explicit stop' ? true : undefined,
                    canClose: errorThenStop,
                });
                if (errorThenStop) {
                    fixture.detectChanges();
                    expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
                        expect.objectContaining({ isLiveView: true })
                    );
                    publishExternalSession({
                        ...session,
                        status: 'closed',
                        canClose: false,
                        closedByRequest: true,
                    });
                }
            } else if (outcome === 'rejected invocation')
                await fixture.whenStable();
            else {
                publishExternalSession(session);
                fixture.detectChanges();
                publishExternalSession({ ...session, playbackIdle: true });
            }
            fixture.detectChanges();

            if (outcome === 'explicit stop' || errorThenStop) {
                expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
                    expect.objectContaining({ isLiveView: false })
                );
                onChannelChange.mock.lastCall?.[0]({ direction: 'up' });
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);
                return;
            }
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
            onRemoteControlCommand.mock.lastCall?.[0]({
                type: 'channel-select-number',
                number: 1,
            });
            expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(
                playing
            );
        }
    );

    it.each(['mpv', 'vlc'] as const)(
        'waits for exact %s close before retrying the same unverified stream',
        async (player) => {
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            const playing = { ...sampleChannel, category_id: 1 };
            emptyList.set([playing]);
            portalPlayer.isEmbeddedPlayer.set(false);
            fixture.detectChanges();
            component.playLive(playing, true);
            const current = {
                id: 'synthetic-unverified',
                player,
                status: 'opened',
                mediaLoaded: false,
                playbackUnverified: true,
                mediaObservationUnavailable: player === 'mpv',
                title: 'Synthetic Channel',
                streamUrl: component.activeStreamUrl(),
                canClose: true,
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
            } as const;
            publishExternalSession(current);
            fixture.detectChanges();
            if (player === 'vlc') {
                publishExternalSession({
                    ...current,
                    restoredFromSessionId: 'synthetic-displaced',
                });
                fixture.detectChanges();
            }
            let finish!: () => void;
            const close = jest.fn(
                () =>
                    new Promise<void>((resolve) => {
                        finish = resolve;
                    })
            );
            Object.defineProperty(
                window.electron,
                'closeExternalPlayerSession',
                {
                    value: close,
                    configurable: true,
                }
            );
            component.guide.open();
            fixture.detectChanges();
            const source = fixture.debugElement.injector.get(
                XtreamEpgGuideSourceService
            );
            expect(source.activeChannelId()).toBeNull();
            const committed = jest.fn();
            source.activate(
                String(playing.xtream_id),
                null,
                undefined,
                committed
            );
            expect(close).toHaveBeenCalledWith(current.id, true);
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);
            publishExternalSession({
                ...current,
                status: 'closed',
                canClose: false,
                closedByRequest: true,
            });
            fixture.detectChanges();
            expect(component.guide.isOpen()).toBe(true);
            xtreamStore.openPlayer.mockReturnValueOnce(
                new Promise(() => undefined)
            );
            finish();
            await Promise.resolve();
            await Promise.resolve();
            await fixture.whenStable();
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
            publishExternalSession({ ...current, id: 'synthetic-retry' });
            fixture.detectChanges();
            expect(component.guide.isOpen()).toBe(true);
            expect(committed).not.toHaveBeenCalled();
        }
    );

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

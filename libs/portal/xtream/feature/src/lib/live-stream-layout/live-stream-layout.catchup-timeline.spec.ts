import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { LiveLayoutSidebarStateService } from '@iptvnator/portal/shared/util';
import {
    EpgGuideComponent,
    EpgGuideNowPlayingComponent,
} from '@iptvnator/ui/epg';
import type {
    EpgProgram,
    ExternalPlayerSession,
} from '@iptvnator/shared/interfaces';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';
import {
    epgItem,
    HOUR,
    playlist,
    sampleChannel,
    StubWebPlayerViewComponent,
} from './live-stream-layout-stubs.spec-data';

/**
 * Catch-up programmes on the player's seek bar. Split from
 * `live-stream-layout.component.spec.ts`, which sits at the spec line cap.
 */
describe('LiveStreamLayoutComponent catch-up timeline segments', () => {
    let fixture: ComponentFixture<LiveStreamLayoutComponent>;
    let component: LiveStreamLayoutComponent;
    const {
        emptyList,
        epgItems,
        parentalLock,
        databaseService,
        runtime,
        portalPlayer,
        closeSession,
        updateRemoteControlStatus,
        onExternalPlayerSessionUpdate,
        publishExternalSession,
        restoreElectron,
        onChannelChange,
        xtreamStore,
    } = setupLiveStreamLayoutNativeFixture();

    beforeEach(() => {
        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        TestBed.inject(LiveLayoutSidebarStateService).setState(
            'portal',
            'expanded'
        );
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        restoreElectron();
    });

    const webPlayer = () =>
        fixture.debugElement.query(By.directive(StubWebPlayerViewComponent))
            .componentInstance as StubWebPlayerViewComponent;

    it.each(['failure', 'idle', 'unverified VLC'] as const)(
        'allows retry of a native guide channel (%s)',
        async (mode) => {
            const playing = { ...sampleChannel, category_id: 1 };
            const next = { ...playing, xtream_id: 102 };
            emptyList.set([playing, next]);
            portalPlayer.isEmbeddedPlayer.set(false);
            component.playLive(playing, true);
            const original: ExternalPlayerSession = {
                id: 'synthetic-session',
                streamUrl: component.activeStreamUrl(),
                title: 'Synthetic Live Channel',
                player: mode === 'unverified VLC' ? 'vlc' : 'mpv',
                status: 'playing',
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
                canClose: true,
            };
            publishExternalSession(original);
            component.guide.open();
            fixture.detectChanges();
            expect(component.guide.isOpen()).toBe(true);
            const source = fixture.debugElement.injector.get(
                XtreamEpgGuideSourceService
            );
            if (mode === 'unverified VLC') {
                source.activate('101');
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);
                expect(source.retryActive(source.channels()[0])).toBe(true);
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
                return;
            }
            if (mode === 'idle') {
                publishExternalSession({ ...original, playbackIdle: true });
                fixture.detectChanges();
                expect(component.guide.isOpen()).toBe(true);
                expect(source.activeChannelId()).toBeNull();
                source.activate('101');
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
                return;
            }
            let fail!: (error: Error) => void;
            const launch = new Promise<void>(
                (_resolve, reject) => (fail = reject)
            );
            xtreamStore.openPlayer.mockReturnValueOnce(launch);
            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.com/second.ts'
            );
            source.activate('102');
            source.activate('102');
            source.activate('102');
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
            expect(source.activeChannelId()).toBe(
                String(sampleChannel.xtream_id)
            );

            fail(new Error('synthetic launch failure'));
            await Promise.resolve();
            fixture.detectChanges();
            component.guide.close();
            expect(component.activeStreamUrl()).toBe(
                'https://example.com/live.ts'
            );
            expect(xtreamStore.setSelectedItem).toHaveBeenLastCalledWith(
                playing
            );
            component.guide.open();
            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.com/second.ts'
            );
            source.activate('102');
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
        }
    );

    it.each([false, true])(
        'resolves hidden categories before external playback (locked: %s)',
        async (locked) => {
            runtime.supportsXtreamSqliteDataSource = true;
            portalPlayer.isEmbeddedPlayer.set(false);
            parentalLock.active.set(true);
            parentalLock.isXtreamCategoryLocked.mockImplementation(
                (_playlist, _type, category) => locked && category === 7
            );
            let resolve!: (rows: unknown[]) => void;
            databaseService.getAllXtreamCategories.mockReturnValueOnce(
                new Promise<unknown[]>((done) => (resolve = done))
            );
            try {
                component.playLive({ ...sampleChannel, category_id: 99 }, true);
                expect(xtreamStore.openPlayer).not.toHaveBeenCalled();
                resolve([{ id: 99, xtream_id: 7 }]);
                await fixture.whenStable();
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(
                    locked ? 0 : 1
                );
            } finally {
                runtime.supportsXtreamSqliteDataSource = false;
            }
        }
    );

    it('allows retry after a replacement opens and closes before rendering', async () => {
        const playing = { ...sampleChannel, category_id: 1 };
        const next = { ...playing, xtream_id: 102 };
        emptyList.set([playing, next]);
        portalPlayer.isEmbeddedPlayer.set(false);
        component.playLive(playing, true);
        const original: ExternalPlayerSession = {
            id: 'synthetic-original',
            streamUrl: component.activeStreamUrl(),
            title: 'Synthetic Channel',
            player: 'vlc',
            status: 'playing',
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
            canClose: true,
        };
        publishExternalSession(original);
        component.guide.open();
        fixture.detectChanges();
        await Promise.resolve();
        const source = fixture.debugElement.injector.get(
            XtreamEpgGuideSourceService
        );
        let resolve!: (session: ExternalPlayerSession) => void;
        xtreamStore.openPlayer.mockReturnValueOnce(
            new Promise<ExternalPlayerSession>((done) => (resolve = done))
        );
        xtreamStore.constructStreamUrl.mockReturnValueOnce(
            'https://example.test/second.ts'
        );
        source.activate('102');
        const replacement = {
            ...original,
            id: 'synthetic-replacement',
            streamUrl: component.activeStreamUrl(),
            status: 'opened',
        } as const;
        publishExternalSession({ ...replacement, status: 'launching' });
        publishExternalSession(replacement);
        resolve(replacement);
        await Promise.resolve();
        publishExternalSession({
            ...replacement,
            status: 'closed',
            canClose: false,
        });
        fixture.detectChanges();

        expect(source.activeChannelId()).toBe('101');
        expect(component.activeStreamUrl()).toBe(original.streamUrl);
        source.activate('102');
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
    });

    it('advances remote tuning past a pending switch and resets after failure', async () => {
        const playing = { ...sampleChannel, category_id: 1 };
        const next = { ...playing, xtream_id: 102 };
        const third = { ...playing, xtream_id: 103 };
        emptyList.set([playing, next, third]);
        portalPlayer.isEmbeddedPlayer.set(false);
        component.playLive(playing, true, [playing, next, third]);
        publishExternalSession({
            id: 'synthetic-remote',
            streamUrl: component.activeStreamUrl(),
            title: playing.name,
            player: 'mpv',
            status: 'playing',
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
            canClose: true,
        });
        fixture.detectChanges();
        const advance = () =>
            onChannelChange.mock.lastCall?.[0]({ direction: 'down' });
        xtreamStore.constructStreamUrl
            .mockReturnValueOnce('https://example.test/second.ts')
            .mockReturnValueOnce('https://example.test/third.ts');
        xtreamStore.openPlayer
            .mockReturnValueOnce(undefined)
            .mockRejectedValueOnce(new Error('Synthetic remote failure'));
        advance();
        expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(next);
        advance();
        expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(third);
        fixture.detectChanges();
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({ channelNumber: 1 })
        );
        await Promise.resolve();
        advance();
        expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(next);
    });

    it.each(['live', 'archive', 'same-channel archive'] as const)(
        'commits the remote order only after %s opens',
        async (mode) => {
            const playing = { ...sampleChannel, category_id: 1 };
            const neighbor = { ...playing, xtream_id: 103 };
            const next = {
                ...playing,
                name: 'Synthetic Replacement Channel',
                xtream_id: 102,
                category_id: 2,
            };
            const nextNeighbor = { ...next, xtream_id: 104 };
            const categories = xtreamStore.getCategoriesBySelectedType();
            xtreamStore.getCategoriesBySelectedType.set([
                ...categories,
                { category_id: 2, category_name: 'Synthetic Group' },
            ]);
            try {
                emptyList.set([playing, neighbor, next, nextNeighbor]);
                portalPlayer.isEmbeddedPlayer.set(false);
                component.playLive(playing, true, [playing, neighbor]);
                const original: ExternalPlayerSession = {
                    id: 'synthetic-first',
                    streamUrl: component.activeStreamUrl(),
                    title: 'Synthetic Channel',
                    player: 'mpv',
                    status: 'playing',
                    startedAt: '2026-04-04T10:00:00Z',
                    updatedAt: '2026-04-04T10:00:00Z',
                    canClose: true,
                };
                publishExternalSession(original);
                component.guide.open();
                fixture.detectChanges();
                const source = fixture.debugElement.injector.get(
                    XtreamEpgGuideSourceService
                );
                const queue = () =>
                    component.channelNavigation
                        .remoteChannels()
                        .map(({ xtream_id }) => xtream_id);
                source.setScope('2');
                xtreamStore.constructStreamUrl.mockReturnValueOnce(
                    'https://example.com/second.ts'
                );
                source.activate('102');
                const replacement: ExternalPlayerSession = {
                    ...original,
                    id: 'synthetic-second',
                    streamUrl: component.activeStreamUrl(),
                    status: 'launching',
                };
                publishExternalSession(replacement);
                xtreamStore.selectedItem.set(next);
                fixture.detectChanges();
                expect(queue()).toEqual([101, 103]);
                expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        channelName: playing.name,
                        channelNumber: 1,
                    })
                );
                onChannelChange.mock.lastCall?.[0]({ direction: 'up' });
                expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(
                    neighbor,
                    expect.any(Function)
                );
                publishExternalSession({
                    ...original,
                    restoredFromSessionId: replacement.id,
                });
                fixture.detectChanges();
                expect(queue()).toEqual([101, 103]);

                const sameChannelArchive = mode === 'same-channel archive';
                const archiveChannel = sameChannelArchive ? playing : next;
                if (mode !== 'live') {
                    component.playLive(
                        archiveChannel,
                        false,
                        sameChannelArchive
                            ? [nextNeighbor, playing]
                            : [next, nextNeighbor]
                    );
                    xtreamStore.selectedItem.set(archiveChannel);
                    epgItems.set([epgItem('Synthetic Archive', 0, 1)]);
                    xtreamStore.openPlayer.mockReturnValueOnce(
                        new Promise(() => undefined)
                    );
                    await component.onProgramActivated({
                        type: 'timeshift',
                        program: component.controlledEpgPrograms()[0],
                    });
                    expect(queue()).toEqual([101, 103]);
                } else {
                    xtreamStore.constructStreamUrl.mockReturnValueOnce(
                        replacement.streamUrl
                    );
                    source.activate('102');
                }
                publishExternalSession({
                    ...replacement,
                    id: 'synthetic-retry',
                    streamUrl: component.activeStreamUrl(),
                    status: 'opened',
                });
                fixture.detectChanges();
                expect(queue()).toEqual(
                    sameChannelArchive ? [104, 101] : [102, 104]
                );
                expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        channelName: archiveChannel.name,
                        channelNumber: sameChannelArchive ? 2 : 1,
                    })
                );
            } finally {
                xtreamStore.getCategoriesBySelectedType.set(categories);
            }
        }
    );

    it.each([
        'playing',
        'replacement',
        'replacement with closable error',
    ] as const)(
        'stops the %s external channel when parental controls relock it',
        (locked) => {
            const playing = { ...sampleChannel, category_id: 1 };
            const next = { ...playing, xtream_id: 102, category_id: 2 };
            portalPlayer.isEmbeddedPlayer.set(false);
            component.playLive(playing, true);
            const original: ExternalPlayerSession = {
                id: 'synthetic-locked-session',
                streamUrl: component.activeStreamUrl(),
                title: 'Synthetic Locked Channel',
                player: 'mpv',
                status: 'playing',
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
                canClose: true,
            };
            publishExternalSession(original);
            component.guide.open();
            fixture.detectChanges();
            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.com/second.ts'
            );
            component.playLive(next, true);
            const pending = {
                ...original,
                id: 'synthetic-pending-session',
                streamUrl: component.activeStreamUrl(),
                status: 'launching',
                canClose: false,
            } as const;
            publishExternalSession(pending);
            fixture.detectChanges();

            parentalLock.isXtreamCategoryLocked.mockImplementation(
                (_playlist, _type, category) =>
                    category === (locked === 'playing' ? 1 : 2)
            );
            parentalLock.active.set(true);
            parentalLock.version.update((version) => version + 1);
            fixture.detectChanges();
            if (locked !== 'playing') {
                expect(component.activeStreamUrl()).toBe(original.streamUrl);
                expect(
                    fixture.debugElement.query(By.directive(EpgGuideComponent))
                ).not.toBeNull();
                expect(closeSession).not.toHaveBeenCalled();
                const opened = {
                    ...pending,
                    status: locked === 'replacement' ? 'opened' : 'error',
                    canClose: true,
                } as const;
                publishExternalSession(opened);
                fixture.detectChanges();
                expect(closeSession).toHaveBeenCalledWith(opened);
                expect(component.guide.available()).toBe(
                    locked !== 'replacement'
                );
                expect(xtreamStore.loadEpg).toHaveBeenCalledTimes(1);
                expect(xtreamStore.setSelectedItem).toHaveBeenLastCalledWith(
                    playing
                );
                return;
            }
            expect(closeSession).toHaveBeenCalledWith(original);
            expect(component.guide.available()).toBe(false);

            publishExternalSession({
                ...original,
                restoredFromSessionId: pending.id,
            });
            fixture.detectChanges();
            expect(component.guideNowPlayingChannel()).toBe('');
            expect(component.activeStreamUrl()).toBe(pending.streamUrl);
            expect(xtreamStore.setSelectedItem).not.toHaveBeenCalledWith(
                playing
            );
            expect(xtreamStore.loadEpg).not.toHaveBeenCalled();
            expect(closeSession).toHaveBeenCalledTimes(1);
        }
    );

    it.each([true, false])(
        'switches EPG copies without restarting playback (embedded: %s)',
        (embedded) => {
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
            const categories = xtreamStore.getCategoriesBySelectedType();
            xtreamStore.getCategoriesBySelectedType.set([
                ...categories,
                { category_id: 2, category_name: 'Synthetic Copy Group' },
            ]);
            try {
                emptyList.set([playing, copy]);
                portalPlayer.isEmbeddedPlayer.set(embedded);
                component.playLive(playing, true);
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
            } finally {
                xtreamStore.getCategoriesBySelectedType.set(categories);
            }
        }
    );

    it('keeps the remote queue and guide on external playback when a preview is relocked', () => {
        const playing = { ...sampleChannel, category_id: 1 };
        const neighbor = { ...playing, xtream_id: 103 };
        const preview = { ...playing, xtream_id: 102, category_id: 2 };
        emptyList.set([playing, neighbor, preview]);
        portalPlayer.isEmbeddedPlayer.set(false);
        component.playLive(playing, true, [playing, neighbor]);
        const confirmed: ExternalPlayerSession = {
            id: 'synthetic-playing',
            streamUrl: component.activeStreamUrl(),
            title: 'Synthetic Channel',
            player: 'mpv',
            status: 'playing',
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
            canClose: true,
        };
        publishExternalSession(confirmed);
        fixture.detectChanges();
        xtreamStore.constructStreamUrl.mockReturnValueOnce(
            'https://example.com/preview.ts'
        );
        component.playLive(preview, false, [preview]);
        fixture.detectChanges();
        expect(component.channelNavigation.remoteChannels()).toEqual([
            playing,
            neighbor,
        ]);
        component.guide.open();
        fixture.detectChanges();
        parentalLock.isXtreamCategoryLocked.mockImplementation(
            (_playlist, _type, category) => category === 2
        );
        parentalLock.version.update((version) => version + 1);
        fixture.detectChanges();
        expect(component.activeStreamUrl()).toBe('');
        expect(component.guide.isOpen()).toBe(true);
        expect(
            fixture.debugElement.query(By.directive(EpgGuideComponent))
        ).not.toBeNull();
        expect(component.guideNowPlayingChannel()).toBe(confirmed.title);
        expect(closeSession).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'keeps a confirmed channel only while its process survives a failed replacement (reused: %s)',
        async (reused) => {
            const playing = { ...sampleChannel, category_id: 1 };
            const next = { ...playing, xtream_id: 102 };
            portalPlayer.isEmbeddedPlayer.set(false);
            component.playLive(playing, true, [playing, next]);
            const original: ExternalPlayerSession = {
                id: 'synthetic-detached',
                streamUrl: component.activeStreamUrl(),
                title: 'Synthetic Playing Channel',
                player: 'mpv',
                status: 'opened',
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
                canClose: true,
            };
            publishExternalSession(original);
            component.guide.open();
            fixture.detectChanges();
            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.test/replacement.ts'
            );
            let fail!: (error: Error) => void;
            xtreamStore.openPlayer.mockReturnValueOnce(
                new Promise((_resolve, reject) => {
                    fail = reject;
                })
            );
            component.playLive(next, true);
            const replacement = {
                ...original,
                id: 'synthetic-replacement',
                streamUrl: component.activeStreamUrl(),
                status: 'launching',
            } as const;
            publishExternalSession(replacement);
            fixture.detectChanges();
            const retireOriginal = () =>
                onExternalPlayerSessionUpdate.mock.lastCall?.[0]({
                    ...original,
                    status: 'closed',
                    canClose: false,
                });
            if (reused) {
                retireOriginal();
                fixture.detectChanges();
                expect(component.guide.isOpen()).toBe(true);
                expect(component.guideNowPlayingChannel()).toBe('');
            }
            publishExternalSession({
                ...replacement,
                status: 'error',
                canClose: false,
            });
            fail(new Error('Synthetic launch failure'));
            await Promise.resolve();
            fixture.detectChanges();
            expect(component.guide.isOpen()).toBe(!reused);
            if (!reused) {
                expect(component.guideNowPlayingChannel()).toBe(original.title);
                expect(component.activeStreamUrl()).toBe(original.streamUrl);
            }

            retireOriginal();
            fixture.detectChanges();
            expect(component.guide.isOpen()).toBe(false);
        }
    );

    it('keeps the allowed session when a queued copy of the same URL is relocked', () => {
        const allowed = { ...sampleChannel, category_id: 1 };
        const restricted = {
            ...allowed,
            category_id: 2,
            epg_channel_id: 'synthetic.restricted',
        };
        emptyList.set([allowed, restricted]);
        portalPlayer.isEmbeddedPlayer.set(false);
        component.playLive(allowed, true, [allowed]);
        const opening: ExternalPlayerSession = {
            id: 'synthetic-allowed',
            streamUrl: component.activeStreamUrl(),
            title: 'Synthetic Channel',
            player: 'mpv',
            status: 'launching',
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
            canClose: true,
        };
        publishExternalSession(opening);
        fixture.detectChanges();
        component.playLive(restricted, true, [restricted]);
        const queued = { ...opening, id: 'synthetic-restricted' };
        publishExternalSession(queued);
        fixture.detectChanges();
        parentalLock.isXtreamCategoryLocked.mockImplementation(
            (_playlist, _type, category) => category === 2
        );
        parentalLock.active.set(true);
        parentalLock.version.update((version) => version + 1);
        fixture.detectChanges();
        publishExternalSession({
            ...opening,
            restoredFromSessionId: queued.id,
        });
        onExternalPlayerSessionUpdate.mock.lastCall?.[0]({
            ...queued,
            status: 'closed',
            canClose: false,
        });
        publishExternalSession({ ...opening, status: 'opened' });
        fixture.detectChanges();

        expect(component.guide.available()).toBe(true);
        expect(component.channelNavigation.remoteChannels()).toEqual([allowed]);
    });

    it.each([
        'direct',
        'failed replacement',
        'unrelated session',
        'switched copy',
        'changed to embedded',
        'launch-only bridge',
    ] as const)(
        'reattaches external playback when Live TV reopens (%s)',
        async (scenario) => {
            const playing = { ...sampleChannel, category_id: 1 };
            const next = { ...playing, xtream_id: 102 };
            const copy = {
                ...playing,
                category_id: 2,
                epg_channel_id: 'synthetic.copy',
            };
            const switched = scenario === 'switched copy';
            const categories = xtreamStore.getCategoriesBySelectedType();
            if (switched)
                xtreamStore.getCategoriesBySelectedType.set([
                    ...categories,
                    { category_id: 2, category_name: 'Synthetic Copy Group' },
                ]);
            emptyList.set(switched ? [playing, next, copy] : [playing, next]);
            portalPlayer.isEmbeddedPlayer.set(false);
            component.playLive(playing, true, [next, playing]);
            const session: ExternalPlayerSession = {
                id: 'synthetic-return',
                streamUrl: component.activeStreamUrl(),
                title: 'Synthetic Channel',
                player: 'mpv',
                status: 'opened',
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
                canClose: true,
            };
            publishExternalSession(session);
            fixture.detectChanges();
            if (switched) {
                component.guide.open();
                fixture.detectChanges();
                const source = fixture.debugElement.injector.get(
                    XtreamEpgGuideSourceService
                );
                source.setScope('2');
                source.activate('101');
                fixture.detectChanges();
            }
            if (scenario === 'failed replacement') {
                xtreamStore.constructStreamUrl.mockReturnValueOnce(
                    'https://example.test/replacement.ts'
                );
                component.playLive(next, true);
                const replacement = {
                    ...session,
                    id: 'synthetic-failed-return',
                    streamUrl: component.activeStreamUrl(),
                    status: 'launching',
                } as const;
                publishExternalSession(replacement);
                publishExternalSession({
                    ...replacement,
                    status: 'error',
                    canClose: false,
                });
                fixture.detectChanges();
            }
            fixture.destroy();
            if (scenario === 'changed to embedded')
                portalPlayer.isEmbeddedPlayer.set(true);
            if (scenario === 'launch-only bridge' && window.electron)
                Reflect.deleteProperty(
                    window.electron,
                    'onExternalPlayerSessionUpdate'
                );
            if (scenario === 'unrelated session') {
                publishExternalSession({
                    ...session,
                    id: 'synthetic-unrelated',
                    streamUrl: 'https://example.test/unrelated.ts',
                });
            }
            fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            component = fixture.componentInstance;
            fixture.detectChanges();
            if (
                scenario === 'changed to embedded' ||
                scenario === 'launch-only bridge'
            ) {
                expect(component.activeStreamUrl()).toBe('');
                expect(component.guide.available()).toBe(false);
                if (scenario === 'launch-only bridge') {
                    xtreamStore.openPlayer.mockResolvedValueOnce(session);
                    component.playLive(playing, true, [playing, next]);
                    await Promise.resolve();
                    expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
                    expect(component.guide.available()).toBe(false);
                }
                return;
            }
            expect(component.guide.available()).toBe(true);
            expect(component.activeStreamUrl()).toBe(session.streamUrl);
            expect(component.channelNavigation.remoteChannels()).toEqual([
                next,
                switched ? copy : playing,
            ]);
            component.guide.open();
            fixture.detectChanges();
            expect(component.guideNowPlayingChannel()).toBe(session.title);
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(
                scenario === 'failed replacement' ? 2 : 1
            );
            xtreamStore.currentPlaylist.set({
                ...playlist,
                id: 'synthetic-next-playlist',
            });
            fixture.detectChanges();
            expect(component.activePlayback()).toBeNull();
            expect(component.guide.available()).toBe(false);
            if (switched)
                xtreamStore.getCategoriesBySelectedType.set(categories);
        }
    );

    it.each(['preview', 'pending'] as const)(
        'uses the latest external guide copy with a %s',
        (state) => {
            const playing = { ...sampleChannel, category_id: 1 };
            const next = {
                ...playing,
                xtream_id: 102,
                epg_channel_id: 'synthetic.first',
            };
            const copy = {
                ...(state === 'preview' ? playing : next),
                category_id: 2,
                epg_channel_id: 'synthetic.copy',
            };
            const categories = xtreamStore.getCategoriesBySelectedType();
            xtreamStore.getCategoriesBySelectedType.set([
                ...categories,
                { category_id: 2, category_name: 'Synthetic Copy Group' },
            ]);
            try {
                emptyList.set([playing, next, copy]);
                portalPlayer.isEmbeddedPlayer.set(false);
                component.playLive(playing, true);
                const original: ExternalPlayerSession = {
                    id: 'synthetic-original',
                    streamUrl: component.activeStreamUrl(),
                    title: 'Synthetic Channel',
                    player: 'mpv',
                    status: 'playing',
                    startedAt: '2026-04-04T10:00:00Z',
                    updatedAt: '2026-04-04T10:00:00Z',
                    canClose: true,
                };
                publishExternalSession(original);
                fixture.detectChanges();
                if (state === 'preview') component.playLive(next, false);
                component.guide.open();
                fixture.detectChanges();
                const source = fixture.debugElement.injector.get(
                    XtreamEpgGuideSourceService
                );
                if (state === 'pending') {
                    xtreamStore.constructStreamUrl.mockReturnValueOnce(
                        'https://example.com/pending.ts'
                    );
                    source.activate('102');
                }
                const playback = component.activePlayback();
                source.setScope('2');
                source.activate(String(copy.xtream_id));
                if (state === 'pending')
                    publishExternalSession({
                        ...original,
                        id: 'synthetic-pending',
                        streamUrl: playback!.streamUrl,
                        status: 'opened',
                    });
                fixture.detectChanges();
                expect(source.playingItem()).toBe(copy);
                expect(component.activePlayback()).toBe(playback);
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(
                    state === 'preview' ? 1 : 2
                );
                if (state === 'pending')
                    expect(
                        xtreamStore.setSelectedItem
                    ).toHaveBeenLastCalledWith(copy);
            } finally {
                xtreamStore.getCategoriesBySelectedType.set(categories);
            }
        }
    );

    it.each([
        'restores original',
        'opens intermediate',
        'restores intermediate',
        'restores intermediate after late launch update',
        'restores detached intermediate',
    ] as const)(
        'tracks the confirmed external channel during overlapping switches (%s)',
        (outcome) => {
            const playing = { ...sampleChannel, category_id: 1 };
            const next = { ...playing, xtream_id: 102 };
            emptyList.set([playing, next]);
            portalPlayer.isEmbeddedPlayer.set(false);
            component.guide.collapsed.set(false);
            component.playLive(playing, false);
            expect(component.guide.available()).toBe(false);

            component.playLive(playing, true);
            const session: ExternalPlayerSession = {
                id: 'synthetic-external-session',
                streamUrl: component.activeStreamUrl(),
                title: 'Synthetic Live Channel',
                player: 'mpv',
                status: 'launching',
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
                canClose: true,
            };
            publishExternalSession(session);
            expect(component.guide.available()).toBe(false);
            publishExternalSession({ ...session, status: 'playing' });
            component.guide.open();
            fixture.detectChanges();
            const summary = fixture.debugElement.query(
                By.directive(EpgGuideNowPlayingComponent)
            );
            expect(summary.componentInstance.collapsed()).toBe(true);
            expect(summary.componentInstance.collapsible()).toBe(false);
            expect(component.guide.collapsed()).toBe(false);

            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.com/next.ts'
            );
            component.playLive(next, true);
            fixture.detectChanges();
            expect(component.guide.isOpen()).toBe(true);
            expect(component.guideNowPlayingChannel()).toBe(session.title);

            const replacement = {
                ...session,
                id: 'synthetic-replacement',
                streamUrl: component.activeStreamUrl(),
                title: 'Synthetic Replacement Channel',
            };
            const late =
                outcome === 'restores intermediate after late launch update';
            if (!late) {
                publishExternalSession(replacement);
                fixture.detectChanges();
            }
            expect(component.guide.isOpen()).toBe(true);

            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.com/third.ts'
            );
            component.playLive({ ...sampleChannel, xtream_id: 103 }, true);
            fixture.detectChanges();
            expect(component.guide.isOpen()).toBe(true);

            const third = {
                ...session,
                id: 'synthetic-third',
                streamUrl: component.activeStreamUrl(),
            };
            if (late) {
                publishExternalSession(replacement);
                fixture.detectChanges();
                expect(component.guide.isOpen()).toBe(true);
            }
            const detached = outcome === 'restores detached intermediate';
            const restoreIntermediate =
                late || detached || outcome === 'restores intermediate';
            if (restoreIntermediate) {
                publishExternalSession(third);
                fixture.detectChanges();
                expect(component.guide.isOpen()).toBe(true);
            }
            const original = outcome === 'restores original';
            const confirmed = original ? session : replacement;
            if (original) {
                publishExternalSession({
                    ...replacement,
                    restoredFromSessionId: third.id,
                });
                fixture.detectChanges();
                expect(component.guideNowPlayingChannel()).toBe(session.title);
            }
            const opened = {
                ...confirmed,
                status: 'playing' as const,
                restoredFromSessionId: original
                    ? replacement.id
                    : restoreIntermediate
                      ? third.id
                      : undefined,
            };
            if (detached) {
                onExternalPlayerSessionUpdate.mock.lastCall?.[0]({
                    ...opened,
                    restoredFromSessionId: undefined,
                });
                publishExternalSession({
                    ...third,
                    status: 'error',
                    canClose: false,
                });
            } else publishExternalSession(opened);
            fixture.detectChanges();

            const source = fixture.debugElement.injector.get(
                XtreamEpgGuideSourceService
            );
            expect(component.guide.isOpen()).toBe(true);
            expect(component.guideNowPlayingChannel()).toBe(confirmed.title);
            expect(source.activeChannelId()).toBe(
                String(original ? sampleChannel.xtream_id : 102)
            );
            expect(source.livePlayback()).toBe(true);
            component.guide.close();
            expect(component.activePlayback()?.streamUrl).toBe(
                confirmed.streamUrl
            );
            expect(xtreamStore.setSelectedItem).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    xtream_id: original ? sampleChannel.xtream_id : 102,
                })
            );
            expect(xtreamStore.loadEpg).toHaveBeenCalled();
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
        }
    );

    it('offers archive playback where provider catch-up can play', () => {
        expect(component.archivePlaybackAvailable()).toBe(true);
        expect(component.archiveDownloadsAvailable()).toBe(true);
    });

    it('offers no archive playback or download where provider catch-up cannot play', () => {
        // The computed reads the flag once; build the layout after the flip.
        runtime.supportsProviderCatchUp = false;
        fixture.destroy();
        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();

        expect(component.archivePlaybackAvailable()).toBe(false);
        expect(component.archiveDownloadsAvailable()).toBe(false);
    });

    it('draws the archive window programmes until live playback resumes', async () => {
        epgItems.set([
            epgItem('Morning News', -1, 0),
            epgItem('Archived Show', 0, 1),
            epgItem('Afternoon Film', 1, 3),
        ]);
        component.playLive(sampleChannel);
        fixture.detectChanges();
        expect(webPlayer().timelineSegments()).toBeNull();

        const archived: EpgProgram = {
            ...component.controlledEpgPrograms()[1],
        };
        await component.onProgramActivated({
            type: 'timeshift',
            program: archived,
        });
        fixture.detectChanges();

        // Xtream's timeshift URL requests exactly the programme.
        expect(webPlayer().timelineSegments()).toEqual([
            { startSeconds: 0, endSeconds: HOUR, title: 'Archived Show' },
        ]);

        component.playLive(sampleChannel);
        fixture.detectChanges();
        expect(webPlayer().timelineSegments()).toBeNull();
    });
});

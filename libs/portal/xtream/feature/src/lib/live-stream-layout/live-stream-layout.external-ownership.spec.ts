import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import { XtreamUrlService } from '@iptvnator/portal/xtream/data-access';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import {
    epgItem,
    playlist,
    sampleChannel,
    StubWebPlayerViewComponent,
} from './live-stream-layout-stubs.spec-data';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';
import { XtreamLiveChannelNavigationService } from './xtream-live-channel-navigation.service';

describe('LiveStreamLayoutComponent external playlist ownership', () => {
    const {
        emptyList,
        epgItems,
        onChannelChange,
        onRemoteControlCommand,
        player,
        portalPlayer,
        publishExternalSession,
        restoreElectron,
        updateRemoteControlStatus,
        xtreamStore,
    } = setupLiveStreamLayoutNativeFixture();

    afterEach(restoreElectron);

    it('commits an inline guide tune only once its own stream starts', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        component.playLive(sampleChannel);
        const previous = component.activePlayback();
        if (!previous) throw new Error('Missing first playback');
        const commit = jest.fn();
        component.playLive(
            { ...sampleChannel, xtream_id: 102 },
            true,
            undefined,
            false,
            commit
        );
        fixture.detectChanges();
        const player = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        ).componentInstance as StubWebPlayerViewComponent;
        expect(commit).not.toHaveBeenCalled();
        player.playbackStarted.emit(previous);
        expect(commit).not.toHaveBeenCalled();
        const current = component.activePlayback();
        if (!current) throw new Error('Missing replacement playback');
        player.playbackStarted.emit(current);
        player.playbackStarted.emit(current);
        expect(commit).toHaveBeenCalledTimes(1);
    });

    function startDetachedGuide() {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const first = { ...sampleChannel, category_id: 1 };
        const second = { ...first, xtream_id: first.xtream_id + 1 };
        const third = { ...first, xtream_id: first.xtream_id + 2 };
        const secondUrl = 'https://example.test/synthetic-second.ts';
        const thirdUrl = 'https://example.test/synthetic-third.ts';
        emptyList.set([first, second, third]);
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(first, true);
        const current = {
            id: 'synthetic-detached-first',
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
        const source = fixture.debugElement.injector.get(
            XtreamEpgGuideSourceService
        );
        const waiting = new Map<string, () => void>();
        const close = jest.fn(
            (id: string, _exact?: boolean) =>
                new Promise<void>((resolve) => {
                    waiting.set(id, resolve);
                })
        );
        Object.defineProperty(window.electron, 'closeExternalPlayerSession', {
            value: close,
            configurable: true,
        });
        const stop = async (session: { id: string; streamUrl: string }) => {
            publishExternalSession({
                ...current,
                ...session,
                status: 'closed',
                canClose: false,
                closedByRequest: true,
            });
            fixture.detectChanges();
            waiting.get(session.id)?.();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        };
        xtreamStore.constructStreamUrl.mockReturnValueOnce(secondUrl);
        xtreamStore.openPlayer.mockImplementation(
            () => new Promise(() => undefined)
        );
        source.activate(String(second.xtream_id));
        return {
            fixture,
            source,
            first,
            third,
            current,
            secondUrl,
            thirdUrl,
            close,
            stop,
        };
    }

    it('waits for an already dispatched player to become exactly closable', async () => {
        const {
            fixture,
            source,
            third,
            current,
            secondUrl,
            thirdUrl,
            close,
            stop,
        } = startDetachedGuide();
        await stop(current);
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
        xtreamStore.constructStreamUrl.mockReturnValueOnce(thirdUrl);
        source.activate(String(third.xtream_id));
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
        const opening = {
            ...current,
            id: 'synthetic-detached-second',
            streamUrl: secondUrl,
            status: 'launching',
            canClose: false,
        } as const;
        publishExternalSession(opening);
        fixture.detectChanges();
        expect(close).toHaveBeenCalledTimes(1);
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
        publishExternalSession({ ...opening, canClose: true });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(close).toHaveBeenLastCalledWith(opening.id, true);
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
        await stop(opening);
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
        expect(xtreamStore.openPlayer.mock.lastCall?.[0]).toBe(thirdUrl);
    });

    it('does not confirm a return to the original row while its player is stopping', async () => {
        const { fixture, source, first, current, close, stop } =
            startDetachedGuide();
        const confirm = jest.fn();
        source.activate(String(first.xtream_id), null, undefined, confirm);
        expect(confirm).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);
        await stop(current);
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
        expect(xtreamStore.openPlayer.mock.lastCall?.[0]).toBe(
            current.streamUrl
        );
        expect(confirm).not.toHaveBeenCalled();
        publishExternalSession({
            ...current,
            id: 'synthetic-restarted',
            mediaLoaded: true,
        });
        fixture.detectChanges();
        expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('keeps the open guide and its scope after the detached replacement fails', async () => {
        const { fixture, source, current, secondUrl, stop } =
            startDetachedGuide();
        source.setScope('1');
        await stop(current);
        expect(fixture.componentInstance.guide.isOpen()).toBe(true);
        publishExternalSession({
            ...current,
            id: 'synthetic-detached-failed',
            streamUrl: secondUrl,
            status: 'error',
            canClose: false,
        });
        fixture.detectChanges();
        expect(fixture.componentInstance.guide.isOpen()).toBe(true);
        expect(source.scopeId()).toBe('1');
    });

    it.each([VideoPlayer.MPV, VideoPlayer.VLC] as const)(
        'closes the exact detached %s before tuning only the newest guide request',
        async (preferred) => {
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            const playing = { ...sampleChannel, category_id: 1 };
            const next = { ...playing, xtream_id: playing.xtream_id + 1 };
            const last = { ...playing, xtream_id: playing.xtream_id + 2 };
            player.set(preferred);
            emptyList.set([playing, next, last]);
            portalPlayer.isEmbeddedPlayer.set(false);
            fixture.detectChanges();
            component.playLive(playing, true);
            const current = {
                id: 'synthetic-detached',
                player: preferred,
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
            const source = fixture.debugElement.injector.get(
                XtreamEpgGuideSourceService
            );
            let finish!: () => void;
            const wait = new Promise<void>((resolve) => {
                finish = resolve;
            });
            const close = jest.fn((_id: string, _exact?: boolean) => wait);
            Object.defineProperty(
                window.electron,
                'closeExternalPlayerSession',
                {
                    value: close,
                    configurable: true,
                }
            );
            const newestUrl = 'https://example.test/synthetic-newest.ts';
            xtreamStore.constructStreamUrl
                .mockReturnValueOnce('https://example.test/synthetic-next.ts')
                .mockReturnValueOnce(newestUrl);
            source.activate(String(next.xtream_id));
            source.activate(String(last.xtream_id));
            expect(close).toHaveBeenCalledWith(current.id, true);
            expect(
                close.mock.calls.every((args) => args[0] === current.id)
            ).toBe(true);
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
            await wait;
            await Promise.resolve();
            await Promise.resolve();
            await fixture.whenStable();
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
            expect(xtreamStore.openPlayer.mock.lastCall?.[0]).toBe(newestUrl);
        }
    );

    it('defers live history under the exact native launch sent to the player', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        const first = { ...sampleChannel, category_id: 1 };
        const second = { ...first, xtream_id: first.xtream_id + 1 };
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(first, true);
        component.playLive(second, true);
        const [original, replacement] = xtreamStore.openPlayer.mock.calls;
        expect(original[0]).toBe(replacement[0]);
        expect(original[5]).toEqual(expect.any(String));
        expect(replacement[5]).not.toBe(original[5]);

        const gate = TestBed.inject(PlaybackHistoryGate);
        gate.confirm({ streamUrls: [original[0]] });
        expect(xtreamStore.addRecentItem).not.toHaveBeenCalled();
        gate.confirm({ launchId: original[5], streamUrls: [original[0]] });
        expect(xtreamStore.addRecentItem).toHaveBeenCalledTimes(1);
        expect(xtreamStore.addRecentItem).toHaveBeenCalledWith(
            expect.objectContaining({ xtreamId: first.xtream_id })
        );
    });

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

    it.each([
        'connection edit',
        'same-channel remote tune',
        'older live confirmation',
    ] as const)(
        'honors the latest archive request after %s',
        async (change) => {
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            const item = { ...sampleChannel, category_id: 1 };
            const next = { ...item, xtream_id: item.xtream_id + 1 };
            const olderLive = change === 'older live confirmation';
            const channels = olderLive ? [item, next] : [item];
            portalPlayer.isEmbeddedPlayer.set(false);
            epgItems.set([epgItem('Synthetic Archive', 0, 1)]);
            emptyList.set(channels);
            xtreamStore.selectedItem.set(item);
            fixture.detectChanges();
            component.playLive(item, true, channels);
            const previous = component.activeStreamUrl();
            const current = {
                id: 'synthetic-current-before-archive',
                player: 'mpv',
                status: 'playing',
                title: 'Synthetic Channel',
                streamUrl: previous,
                canClose: true,
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
            } as const;
            if (change !== 'connection edit') {
                publishExternalSession(current);
                fixture.detectChanges();
            }
            const nextUrl = 'https://example.test/synthetic-older-live.ts';
            if (olderLive) {
                xtreamStore.constructStreamUrl.mockReturnValueOnce(nextUrl);
                xtreamStore.openPlayer.mockReturnValueOnce(
                    new Promise(() => undefined)
                );
                onChannelChange.mock.lastCall?.[0]({ direction: 'up' });
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(2);
            }
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
            if (change === 'same-channel remote tune') {
                onRemoteControlCommand.mock.lastCall?.[0]({
                    type: 'channel-select-number',
                    number: 1,
                });
                expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);
            } else if (olderLive) {
                publishExternalSession({
                    ...current,
                    id: 'synthetic-older-live',
                    streamUrl: nextUrl,
                });
                fixture.detectChanges();
                expect(component.activeStreamUrl()).toBe(nextUrl);
            } else
                xtreamStore.currentPlaylist.set({
                    ...playlist,
                    serverUrl: 'https://another.example.test',
                });
            const archiveUrl = 'https://example.test/synthetic-archive.ts';
            if (olderLive)
                xtreamStore.openPlayer.mockReturnValueOnce(
                    new Promise(() => undefined)
                );
            resolve(archiveUrl);
            await opening;
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(
                olderLive ? 3 : 1
            );
            if (olderLive) {
                expect(xtreamStore.openPlayer.mock.lastCall?.[0]).toBe(
                    archiveUrl
                );
                publishExternalSession({
                    ...current,
                    id: 'synthetic-newer-archive',
                    streamUrl: archiveUrl,
                });
                fixture.detectChanges();
            }
            expect(component.activeStreamUrl()).toBe(
                olderLive ? archiveUrl : previous
            );
        }
    );

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
        'VLC initially waiting',
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
            const preferred = outcome.includes('VLC')
                ? VideoPlayer.VLC
                : VideoPlayer.MPV;
            player.set(preferred);
            emptyList.set([first, next]);
            portalPlayer.isEmbeddedPlayer.set(false);
            fixture.detectChanges();
            component.playLive(first, true);
            const current = {
                id: 'synthetic-current',
                player: preferred,
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
            publishExternalSession({
                ...replacement,
                mediaLoaded: false,
                playbackIdle:
                    outcome === 'VLC initially waiting' ? false : undefined,
            });
            fixture.detectChanges();
            expect(committed).not.toHaveBeenCalled();
            expect(source.activeChannelId()).toBe(String(first.xtream_id));
            if (outcome !== 'loaded' && outcome !== 'VLC initially waiting') {
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
        'VLC timeout then exit',
        'VLC timeout then Stop',
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
            const timedOut = outcome.startsWith('VLC timeout');
            const requestedStop =
                outcome === 'explicit stop' ||
                outcome === 'VLC timeout then Stop';
            const terminal =
                errorThenStop ||
                timedOut ||
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
                player: outcome === 'vlc' || timedOut ? 'vlc' : 'mpv',
                status: 'opened',
                mediaLoaded: outcome !== 'first MPV failure' && !timedOut,
                title: 'Synthetic Channel',
                streamUrl: component.activeStreamUrl(),
                canClose: true,
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
            } as const;
            if (terminal) {
                if (timedOut) {
                    publishExternalSession({
                        ...session,
                        mediaReadinessTimedOut: true,
                        playbackUnverified: true,
                    });
                    fixture.detectChanges();
                    expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
                        expect.objectContaining({ isLiveView: true })
                    );
                }
                publishExternalSession({
                    ...session,
                    launchId: xtreamStore.openPlayer.mock.lastCall?.[5],
                    status:
                        outcome === 'native error' || errorThenStop
                            ? 'error'
                            : 'closed',
                    closedByRequest: requestedStop ? true : undefined,
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

            if (requestedStop || errorThenStop) {
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

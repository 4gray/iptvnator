import { EpgSourceSettingsService } from '@iptvnator/services';
import { CdkFixedSizeVirtualScroll } from '@angular/cdk/scrolling';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import {
    FavoriteItem,
    EpgQueueService,
    FavoritesService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { ChannelListItemComponent } from '@iptvnator/ui/components';
import { PortalChannelsListComponent } from './portal-channels-list.component';
import { XtreamFavoriteMarksService } from './xtream-favorite-marks.service';

function buildEpgItem(params: {
    id: string;
    title: string;
    start: string;
    stop: string;
    startTimestamp: number;
    stopTimestamp: number;
}) {
    return {
        id: params.id,
        epg_id: `epg-${params.id}`,
        title: params.title,
        description: `${params.title} description`,
        lang: 'en',
        start: params.start,
        end: params.stop,
        stop: params.stop,
        channel_id: 'channel-1',
        start_timestamp: String(params.startTimestamp),
        stop_timestamp: String(params.stopTimestamp),
    };
}

describe('PortalChannelsListComponent', () => {
    const testWindow = window as unknown as { electron?: unknown };
    const originalElectron = testWindow.electron;
    let fixture: ComponentFixture<PortalChannelsListComponent>;
    const selectedChannels = signal<unknown[]>([]);
    const selectedItem = signal<unknown>(null);
    const epgItems = signal<unknown[]>([]);
    const selectedTypeContentLoading = signal(true);
    const selectedContentType = signal('live');
    const currentPlaylist = signal<unknown>(null);
    const selectedCategoryId = signal<number | null>(1);
    const storeSignals = {
        selectItemsFromSelectedCategory: selectedChannels,
        selectedItem,
        epgItems,
        selectedTypeContentLoading,
        selectedContentType,
        currentPlaylist,
        selectedCategoryId,
        setSelectedCategory: jest.fn(),
        toggleFavorite: jest.fn().mockResolvedValue(true),
    };
    const epgResults$ = new Subject<{ streamId: number; items: unknown[] }>();
    const favoritesService = {
        getFavorites: jest.fn().mockReturnValue(of([] as FavoriteItem[])),
    };
    const epgQueueService = {
        epgResult$: epgResults$,
        getCached: jest.fn().mockReturnValue(null),
        enqueue: jest.fn().mockResolvedValue(undefined),
        invalidate: jest.fn(),
    };

    beforeEach(async () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: { platform: 'darwin' },
        });
        storeSignals.setSelectedCategory.mockClear();
        storeSignals.toggleFavorite.mockClear();
        selectedChannels.set([]);
        selectedItem.set(null);
        epgItems.set([]);
        selectedTypeContentLoading.set(true);
        selectedContentType.set('live');
        currentPlaylist.set(null);
        selectedCategoryId.set(1);
        favoritesService.getFavorites.mockReturnValue(of([] as FavoriteItem[]));
        epgQueueService.getCached.mockReturnValue(null);
        epgQueueService.enqueue.mockClear();
        epgQueueService.invalidate.mockClear();

        await TestBed.configureTestingModule({
            imports: [PortalChannelsListComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) =>
                            key === 'CHANNELS.LOADING'
                                ? 'Loading channels...'
                                : key,
                        get: (key: string) =>
                            of(
                                key === 'CHANNELS.LOADING'
                                    ? 'Loading channels...'
                                    : key
                            ),
                        stream: (key: string) =>
                            of(
                                key === 'CHANNELS.LOADING'
                                    ? 'Loading channels...'
                                    : key
                            ),
                        onLangChange: new Subject(),
                        onTranslationChange: new Subject(),
                        onDefaultLangChange: new Subject(),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: storeSignals,
                },
                {
                    provide: FavoritesService,
                    useValue: favoritesService,
                },
                {
                    provide: EpgQueueService,
                    useValue: epgQueueService,
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpg() {
                            return Boolean(window.electron);
                        },
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            params: {},
                        },
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(PortalChannelsListComponent);
    });

    afterEach(() => {
        jest.useRealTimers();
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: originalElectron,
        });
    });

    it('clears visible cached XMLTV previews and re-enqueues after a source changes', () => {
        const component = fixture.componentInstance;
        component.epgPrograms.set(50, { title: 'Removed programme' } as never);
        component.currentProgramsProgress.set(50, 20);
        TestBed.inject(EpgSourceSettingsService).changed$.next();
        expect(component.epgPrograms.size).toBe(0);
        expect(component.currentProgramsProgress.size).toBe(0);
    });

    it('renders a loading placeholder instead of the empty state while xtream live content is still loading', () => {
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.channels-loading-state')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.empty-search-state')
        ).toBeNull();
    });

    it('renders the empty state once loading has finished and the selected category has no channels', () => {
        selectedTypeContentLoading.set(false);

        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.channels-loading-state')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.empty-search-state')
        ).not.toBeNull();
    });

    it('selects the current preview program by timestamps, preserves them, and updates progress from them', () => {
        jest.useFakeTimers();
        const currentStartTimestamp = Math.floor(
            Date.parse('2026-04-05T05:30:00.000Z') / 1000
        );
        const currentStopTimestamp = Math.floor(
            Date.parse('2026-04-05T06:00:00.000Z') / 1000
        );
        const previousStartTimestamp = Math.floor(
            Date.parse('2026-04-05T05:00:00.000Z') / 1000
        );
        const previousStopTimestamp = Math.floor(
            Date.parse('2026-04-05T05:30:00.000Z') / 1000
        );

        jest.setSystemTime(new Date('2026-04-05T05:45:00.000Z'));

        selectedTypeContentLoading.set(false);
        selectedChannels.set([
            {
                title: 'Cartoon Network',
                xtream_id: 50,
            },
        ]);
        currentPlaylist.set({
            id: 'playlist-1',
            password: 'secret',
            serverUrl: 'http://demo.example',
            username: 'demo',
        });

        fixture.detectChanges();

        epgResults$.next({
            streamId: 50,
            items: [
                buildEpgItem({
                    id: 'previous',
                    title: 'Previous Show',
                    start: '2026-04-05T03:00:00.000Z',
                    stop: '2026-04-05T03:30:00.000Z',
                    startTimestamp: previousStartTimestamp,
                    stopTimestamp: previousStopTimestamp,
                }),
                buildEpgItem({
                    id: 'current',
                    title: 'Current Show',
                    start: '2026-04-05T03:00:00.000Z',
                    stop: '2026-04-05T03:30:00.000Z',
                    startTimestamp: currentStartTimestamp,
                    stopTimestamp: currentStopTimestamp,
                }),
            ],
        });

        fixture.detectChanges();

        const component = fixture.componentInstance;
        expect(component.epgPrograms.get(50)).toEqual(
            expect.objectContaining({
                title: 'Current Show',
                startTimestamp: currentStartTimestamp,
                stopTimestamp: currentStopTimestamp,
            })
        );
        expect(component.currentProgramsProgress.get(50)).toBeCloseTo(50, 1);
    });

    /** Sizes the viewport so its rendered range covers the given channels and
     * `lastVisibleChannels` gets populated, matching what a real scroll does. */
    async function renderViewport(
        fixture: ComponentFixture<PortalChannelsListComponent>
    ) {
        const viewport = fixture.componentInstance.viewport();
        if (!viewport) {
            throw new Error('Expected channel viewport');
        }
        Object.defineProperty(
            viewport.elementRef.nativeElement,
            'clientHeight',
            {
                configurable: true,
                value: 520,
            }
        );
        viewport.checkViewportSize();
        fixture.detectChanges();
        await fixture.whenStable();
        jest.advanceTimersByTime(300); // renderedRangeStream's debounceTime
        fixture.detectChanges();
    }

    it('re-picks a channel current program once its end time passes, without a scroll or re-entry (#767)', async () => {
        jest.useFakeTimers();
        const firstStartTimestamp = Math.floor(
            Date.parse('2026-04-05T05:30:00.000Z') / 1000
        );
        const firstStopTimestamp = Math.floor(
            Date.parse('2026-04-05T06:00:00.000Z') / 1000
        );
        const secondStartTimestamp = firstStopTimestamp;
        const secondStopTimestamp = Math.floor(
            Date.parse('2026-04-05T06:30:00.000Z') / 1000
        );

        jest.setSystemTime(new Date('2026-04-05T05:45:00.000Z'));

        selectedTypeContentLoading.set(false);
        selectedChannels.set([
            {
                title: 'Cartoon Network',
                xtream_id: 50,
            },
        ]);
        currentPlaylist.set({
            id: 'playlist-1',
            password: 'secret',
            serverUrl: 'http://demo.example',
            username: 'demo',
        });

        fixture.detectChanges();
        await renderViewport(fixture);

        const firstProgram = buildEpgItem({
            id: 'first',
            title: 'Current Show',
            start: '2026-04-05T05:30:00.000Z',
            stop: '2026-04-05T06:00:00.000Z',
            startTimestamp: firstStartTimestamp,
            stopTimestamp: firstStopTimestamp,
        });
        const secondProgram = buildEpgItem({
            id: 'second',
            title: 'Next Show',
            start: '2026-04-05T06:00:00.000Z',
            stop: '2026-04-05T06:30:00.000Z',
            startTimestamp: secondStartTimestamp,
            stopTimestamp: secondStopTimestamp,
        });

        epgResults$.next({
            streamId: 50,
            items: [firstProgram, secondProgram],
        });
        fixture.detectChanges();

        const component = fixture.componentInstance;
        expect(component.epgPrograms.get(50)?.title).toBe('Current Show');

        // The queue's cache holds both programmes for this channel, as it
        // would once the EPG result above had arrived through the real
        // service.
        epgQueueService.getCached.mockImplementation((streamId: number) =>
            streamId === 50 ? [firstProgram, secondProgram] : null
        );
        epgQueueService.enqueue.mockClear();

        // Wall-clock time moves past the first programme's end with no
        // scroll-out/in and no EPG settings change: the reporter's exact
        // scenario from #767. The channel stays on screen throughout; the
        // 60s interval fires several times along the way, landing on the
        // next programme by the time 20 minutes have passed.
        jest.advanceTimersByTime(20 * 60 * 1000);

        expect(component.epgPrograms.get(50)?.title).toBe('Next Show');
        // The cache was already warm, so the refresh re-picked from it
        // instead of enqueuing a new fetch.
        expect(epgQueueService.enqueue).not.toHaveBeenCalled();
    });

    it('re-fetches EPG on the refresh tick once the cache has expired, without blanking the row (#767)', async () => {
        // The queue's own cache is short-lived (a 5 minute TTL); a channel
        // left on screen without a scroll event needs the periodic refresh
        // to re-fetch it, not just re-pick from a cache entry that is gone.
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-04-05T05:45:00.000Z'));

        selectedTypeContentLoading.set(false);
        selectedChannels.set([
            {
                title: 'Cartoon Network',
                xtream_id: 50,
            },
        ]);
        currentPlaylist.set({
            id: 'playlist-1',
            password: 'secret',
            serverUrl: 'http://demo.example',
            username: 'demo',
        });

        fixture.detectChanges();
        await renderViewport(fixture);

        epgResults$.next({
            streamId: 50,
            items: [
                buildEpgItem({
                    id: 'first',
                    title: 'Current Show',
                    start: '2026-04-05T05:30:00.000Z',
                    stop: '2026-04-05T06:00:00.000Z',
                    startTimestamp: Math.floor(
                        Date.parse('2026-04-05T05:30:00.000Z') / 1000
                    ),
                    stopTimestamp: Math.floor(
                        Date.parse('2026-04-05T06:00:00.000Z') / 1000
                    ),
                }),
            ],
        });
        fixture.detectChanges();
        const component = fixture.componentInstance;
        expect(component.epgPrograms.get(50)?.title).toBe('Current Show');

        // Simulate the cache having aged out: getCached now returns null.
        epgQueueService.getCached.mockReturnValue(null);
        epgQueueService.enqueue.mockClear();

        jest.advanceTimersByTime(20 * 60 * 1000);

        expect(epgQueueService.enqueue).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ streamId: 50 })]),
            expect.any(Set),
            expect.objectContaining({ serverUrl: 'http://demo.example' })
        );
        // The row is never cleared while the fetch is in flight: it keeps
        // showing the last-known program instead of going blank.
        expect(component.epgPrograms.get(50)?.title).toBe('Current Show');

        // The fetch resolves with the next programme; the row updates.
        epgResults$.next({
            streamId: 50,
            items: [
                buildEpgItem({
                    id: 'second',
                    title: 'Next Show',
                    start: '2026-04-05T06:00:00.000Z',
                    stop: '2026-04-05T06:30:00.000Z',
                    startTimestamp: Math.floor(
                        Date.parse('2026-04-05T06:00:00.000Z') / 1000
                    ),
                    stopTimestamp: Math.floor(
                        Date.parse('2026-04-05T06:30:00.000Z') / 1000
                    ),
                }),
            ],
        });
        fixture.detectChanges();
        expect(component.epgPrograms.get(50)?.title).toBe('Next Show');
    });

    it('does not fetch off-screen channels on the refresh tick when nothing has been scrolled into view', () => {
        // No renderViewport() here: lastVisibleChannels stays empty, as it
        // would before the first scroll event settles.
        jest.useFakeTimers();
        selectedTypeContentLoading.set(false);
        selectedChannels.set(
            Array.from({ length: 60 }, (_, index) => ({
                title: `Channel ${index + 1}`,
                xtream_id: index + 1,
            }))
        );
        currentPlaylist.set({
            id: 'playlist-1',
            password: 'secret',
            serverUrl: 'http://demo.example',
            username: 'demo',
        });

        fixture.detectChanges();
        epgQueueService.enqueue.mockClear();

        jest.advanceTimersByTime(60_000);

        expect(epgQueueService.enqueue).not.toHaveBeenCalled();
    });

    /**
     * One channel on screen, the clock parked at `nowIso`.
     *
     * `keepTimers` is for a second list mounted beside the first: re-installing
     * the fake clock would drop the intervals the first one had registered, and
     * the test would silently observe a single component.
     */
    async function renderSingleChannel(
        fixture: ComponentFixture<PortalChannelsListComponent>,
        nowIso: string,
        options: { keepTimers?: boolean } = {}
    ) {
        if (!options.keepTimers) {
            jest.useFakeTimers();
        }
        jest.setSystemTime(new Date(nowIso));
        selectedTypeContentLoading.set(false);
        selectedChannels.set([{ title: 'Cartoon Network', xtream_id: 50 }]);
        currentPlaylist.set({
            id: 'playlist-1',
            password: 'secret',
            serverUrl: 'http://demo.example',
            username: 'demo',
        });

        fixture.detectChanges();
        await renderViewport(fixture);
        epgQueueService.enqueue.mockClear();
        epgQueueService.invalidate.mockClear();
    }

    function buildProgram(title: string, startIso: string, stopIso: string) {
        return buildEpgItem({
            id: title,
            title,
            start: startIso,
            stop: stopIso,
            startTimestamp: Math.floor(Date.parse(startIso) / 1000),
            stopTimestamp: Math.floor(Date.parse(stopIso) / 1000),
        });
    }

    it('never falls back to a finished program once the cached guide runs out (#767)', async () => {
        // The queue caches a short EPG for five minutes, so a channel whose
        // listings are shorter than that reaches a state where every cached
        // program has already ended -- the shape an uploaded-XMLTV fallback
        // always has, since it caches the single current program.
        await renderSingleChannel(fixture, '2026-04-05T05:45:00.000Z');

        const early = buildProgram(
            'Early Show',
            '2026-04-05T05:30:00.000Z',
            '2026-04-05T06:00:00.000Z'
        );
        const short = buildProgram(
            'Short Show',
            '2026-04-05T06:00:00.000Z',
            '2026-04-05T06:02:00.000Z'
        );
        epgQueueService.getCached.mockImplementation((streamId: number) =>
            streamId === 50 ? [early, short] : null
        );

        epgResults$.next({ streamId: 50, items: [early, short] });
        fixture.detectChanges();
        const component = fixture.componentInstance;
        expect(component.epgPrograms.get(50)?.title).toBe('Early Show');

        // 05:45 -> 06:03: both cached programs are now over. The row must not
        // rewind to the oldest one, which is what the preview pick returns
        // when nothing is on air.
        jest.advanceTimersByTime(18 * 60 * 1000);

        expect(component.epgPrograms.get(50)?.title).toBe('Short Show');
        // The exhausted entry is dropped, because the queue skips any stream
        // that still has a cached answer, and fresh data is requested.
        expect(epgQueueService.invalidate).toHaveBeenCalledWith(50);
        expect(epgQueueService.enqueue).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ streamId: 50 })]),
            expect.any(Set),
            expect.objectContaining({ serverUrl: 'http://demo.example' })
        );

        epgResults$.next({
            streamId: 50,
            items: [
                buildProgram(
                    'Live Show',
                    '2026-04-05T06:02:00.000Z',
                    '2026-04-05T06:40:00.000Z'
                ),
            ],
        });
        fixture.detectChanges();
        expect(component.epgPrograms.get(50)?.title).toBe('Live Show');
    });

    it('keeps the last program when a refill answers with the same stale guide', async () => {
        // The provider has simply stopped publishing for this channel, so the
        // refill returns the window that is already over. Feeding that through
        // the first-paint fallback would walk the row back to the oldest entry.
        await renderSingleChannel(fixture, '2026-04-05T05:45:00.000Z');

        const early = buildProgram(
            'Early Show',
            '2026-04-05T05:30:00.000Z',
            '2026-04-05T06:00:00.000Z'
        );
        const short = buildProgram(
            'Short Show',
            '2026-04-05T06:00:00.000Z',
            '2026-04-05T06:02:00.000Z'
        );
        epgQueueService.getCached.mockImplementation((streamId: number) =>
            streamId === 50 ? [early, short] : null
        );
        epgResults$.next({ streamId: 50, items: [early, short] });
        fixture.detectChanges();

        jest.advanceTimersByTime(18 * 60 * 1000);
        const component = fixture.componentInstance;
        expect(component.epgPrograms.get(50)?.title).toBe('Short Show');

        epgResults$.next({ streamId: 50, items: [early, short] });
        fixture.detectChanges();

        expect(component.epgPrograms.get(50)?.title).toBe('Short Show');
    });

    it('refills an exhausted guide at most once per cache lifetime', async () => {
        // A provider whose guide has genuinely run out answers the refill with
        // the same finished program, so without a floor the row would drop and
        // re-request its cache on every single tick.
        await renderSingleChannel(fixture, '2026-04-05T06:03:00.000Z');

        const finished = buildProgram(
            'Finished Show',
            '2026-04-05T05:30:00.000Z',
            '2026-04-05T06:00:00.000Z'
        );
        epgQueueService.getCached.mockImplementation((streamId: number) =>
            streamId === 50 ? [finished] : null
        );
        epgResults$.next({ streamId: 50, items: [finished] });
        fixture.detectChanges();

        jest.advanceTimersByTime(4 * 60 * 1000);
        expect(epgQueueService.invalidate).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(2 * 60 * 1000);
        expect(epgQueueService.invalidate).toHaveBeenCalledTimes(2);
    });

    it('shares the refill floor between the sidebar list and its fullscreen copy', async () => {
        // A live layout mounts this component more than once over one EPG
        // queue. A refill record per component would hand each copy its own
        // allowance, so the same exhausted guide would be dropped and
        // refetched once per mounted list every minute.
        await renderSingleChannel(fixture, '2026-04-05T06:03:00.000Z');
        const fullscreenCopy = TestBed.createComponent(
            PortalChannelsListComponent
        );
        await renderSingleChannel(fullscreenCopy, '2026-04-05T06:03:00.000Z', {
            keepTimers: true,
        });

        const finished = buildProgram(
            'Finished Show',
            '2026-04-05T05:30:00.000Z',
            '2026-04-05T06:00:00.000Z'
        );
        epgQueueService.getCached.mockImplementation((streamId: number) =>
            streamId === 50 ? [finished] : null
        );
        epgResults$.next({ streamId: 50, items: [finished] });
        fixture.detectChanges();
        fullscreenCopy.detectChanges();

        jest.advanceTimersByTime(4 * 60 * 1000);

        expect(epgQueueService.invalidate).toHaveBeenCalledTimes(1);
    });

    it('leaves a channel the provider has no EPG for alone', async () => {
        // An empty answer is cached deliberately; re-requesting it would put
        // one call per EPG-less visible row on the wire every minute.
        await renderSingleChannel(fixture, '2026-04-05T06:03:00.000Z');
        epgQueueService.getCached.mockReturnValue([]);

        jest.advanceTimersByTime(5 * 60 * 1000);

        expect(epgQueueService.enqueue).not.toHaveBeenCalled();
        expect(epgQueueService.invalidate).not.toHaveBeenCalled();
    });

    it('advances the progress bar of a running program without touching the queue', async () => {
        await renderSingleChannel(fixture, '2026-04-05T06:00:00.000Z');
        epgQueueService.getCached.mockReturnValue(null);

        epgResults$.next({
            streamId: 50,
            items: [
                buildProgram(
                    'Long Show',
                    '2026-04-05T05:00:00.000Z',
                    '2026-04-05T07:00:00.000Z'
                ),
            ],
        });
        fixture.detectChanges();
        const component = fixture.componentInstance;
        expect(component.currentProgramsProgress.get(50)).toBeCloseTo(50, 1);
        epgQueueService.getCached.mockClear();

        jest.advanceTimersByTime(30 * 60 * 1000);

        expect(component.currentProgramsProgress.get(50)).toBeCloseTo(75, 1);
        expect(epgQueueService.getCached).not.toHaveBeenCalled();
        expect(epgQueueService.enqueue).not.toHaveBeenCalled();
    });

    it('does not derive or subscribe to row EPG previews in browser/PWA mode', async () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        selectedTypeContentLoading.set(false);
        selectedChannels.set([
            {
                title: 'Cartoon Network',
                xtream_id: 50,
            },
        ]);
        selectedItem.set({ xtream_id: 50 });
        epgItems.set([
            buildEpgItem({
                id: 'current',
                title: 'Current Show',
                start: new Date(Date.now() - 60_000).toISOString(),
                stop: new Date(Date.now() + 60_000).toISOString(),
                startTimestamp: Math.floor((Date.now() - 60_000) / 1000),
                stopTimestamp: Math.floor((Date.now() + 60_000) / 1000),
            }),
        ]);

        fixture.destroy();
        fixture = TestBed.createComponent(PortalChannelsListComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        epgResults$.next({
            streamId: 50,
            items: [
                buildEpgItem({
                    id: 'queued-current',
                    title: 'Queued Current Show',
                    start: new Date(Date.now() - 60_000).toISOString(),
                    stop: new Date(Date.now() + 60_000).toISOString(),
                    startTimestamp: Math.floor((Date.now() - 60_000) / 1000),
                    stopTimestamp: Math.floor((Date.now() + 60_000) / 1000),
                }),
            ],
        });

        const pwaComponent = fixture.componentInstance;
        expect(pwaComponent.supportsEpg).toBe(false);
        expect(pwaComponent.channelItemSize).toBe(52);
        expect(pwaComponent.epgPrograms.size).toBe(0);
        expect(pwaComponent.currentProgramsProgress.size).toBe(0);

        const virtualScrollElement = fixture.debugElement.query(
            By.css('cdk-virtual-scroll-viewport')
        );
        if (!virtualScrollElement) {
            throw new Error(
                `Expected PWA channel viewport, received: ${fixture.nativeElement.innerHTML.slice(0, 1000)}`
            );
        }
        const virtualScroll = virtualScrollElement.injector.get(
            CdkFixedSizeVirtualScroll
        );
        Object.defineProperty(
            virtualScrollElement.nativeElement,
            'clientHeight',
            {
                configurable: true,
                value: 520,
            }
        );
        pwaComponent.viewport()?.checkViewportSize();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const channelRow = fixture.debugElement
            .query(By.directive(ChannelListItemComponent))
            .injector.get(ChannelListItemComponent);
        expect(virtualScroll.itemSize).toBe(52);
        expect(channelRow.showEpg()).toBe(false);
        expect(
            fixture.nativeElement
                .querySelector('.channel-list-item')
                .classList.contains('compact')
        ).toBe(true);
    });

    it('does not mark a live item as favorite when only a colliding movie ID is favorited', () => {
        favoritesService.getFavorites.mockReturnValue(
            of([
                {
                    content_id: 42,
                    playlist_id: 'playlist-1',
                    type: 'movie',
                    title: 'Krypton',
                    category_id: 7,
                    xtream_id: 290,
                },
            ] satisfies FavoriteItem[])
        );
        selectedTypeContentLoading.set(false);
        selectedChannels.set([
            {
                title: 'SE: V Film Premiere FHD',
                type: 'live',
                xtream_id: 290,
            },
        ]);
        currentPlaylist.set({
            id: 'playlist-1',
            password: 'secret',
            serverUrl: 'http://demo.example',
            username: 'demo',
        });

        fixture.detectChanges();

        const component = fixture.componentInstance;
        expect(component.favorites.get('movie:290')).toBe(true);
        expect(component.favorites.get('live:290')).toBeUndefined();
        expect(
            component.favoriteKeyFor({
                title: 'SE: V Film Premiere FHD',
                type: 'live',
                xtream_id: 290,
            })
        ).toBe('live:290');
    });

    it('scrolls the virtual list to the selected live channel', () => {
        const channels = Array.from({ length: 20 }, (_, index) => ({
            title: `Channel ${index + 1}`,
            xtream_id: index + 1,
        }));
        selectedTypeContentLoading.set(false);
        selectedChannels.set(channels);
        fixture.detectChanges();

        const viewport = fixture.componentInstance.viewport();
        if (!viewport) {
            throw new Error('Expected virtual scroll viewport');
        }
        const scrollToIndex = jest.spyOn(viewport, 'scrollToIndex');

        selectedItem.set({ xtream_id: 16 });
        fixture.detectChanges();

        expect(scrollToIndex).toHaveBeenCalledWith(15, 'smooth');
    });

    it('explicitly reveals and focuses an unchanged selected channel after browsing away', () => {
        const requestFrame = jest
            .spyOn(window, 'requestAnimationFrame')
            .mockReturnValue(100000);
        selectedTypeContentLoading.set(false);
        selectedChannels.set(
            Array.from({ length: 20 }, (_, index) => ({
                xtream_id: index + 1,
                title: `Channel ${index + 1}`,
            }))
        );
        selectedItem.set({ xtream_id: 16 });
        fixture.detectChanges();
        const viewport = fixture.componentInstance.viewport();
        if (!viewport) throw new Error('Expected channel viewport');
        const scroll = jest.spyOn(viewport, 'scrollToIndex');
        const focus = jest.spyOn(viewport.elementRef.nativeElement, 'focus');
        fixture.componentRef.setInput('revealRequest', {
            channelId: 16,
            sequence: 1,
        });
        fixture.detectChanges();
        expect(scroll).not.toHaveBeenCalled();
        const frame =
            requestFrame.mock.calls[requestFrame.mock.calls.length - 1]?.[0];
        frame?.(0);
        requestFrame.mockRestore();
        expect(scroll).toHaveBeenCalledWith(15, 'auto');
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        scroll.mockClear();
        selectedChannels.set([...selectedChannels()]);
        fixture.detectChanges();
        expect(scroll).not.toHaveBeenCalled();
    });

    it('does not start smooth alignment when a selected row is already visible', () => {
        selectedTypeContentLoading.set(false);
        selectedChannels.set(
            Array.from({ length: 20 }, (_, index) => ({
                title: `Channel ${index + 1}`,
                xtream_id: index + 1,
            }))
        );
        fixture.detectChanges();
        const viewport = fixture.componentInstance.viewport()!;
        jest.spyOn(viewport, 'getViewportSize').mockReturnValue(400);
        jest.spyOn(viewport, 'measureScrollOffset').mockReturnValue(0);
        const scroll = jest.spyOn(viewport, 'scrollToIndex');
        selectedItem.set({ xtream_id: 2 });
        fixture.detectChanges();
        expect(scroll).not.toHaveBeenCalled();
    });

    it('does not realign after an update to the same selected channel', () => {
        selectedTypeContentLoading.set(false);
        selectedChannels.set(
            Array.from({ length: 20 }, (_, index) => ({
                title: `Channel ${index + 1}`,
                xtream_id: index + 1,
            }))
        );
        fixture.detectChanges();
        const viewport = fixture.componentInstance.viewport()!;
        selectedItem.set({ xtream_id: 2 });
        fixture.detectChanges();
        const scroll = jest.spyOn(viewport, 'scrollToIndex');
        selectedItem.set({ xtream_id: 2 });
        fixture.detectChanges();
        expect(scroll).not.toHaveBeenCalled();
    });

    it('does not re-scroll the virtual list when the search filter changes', () => {
        const channels = Array.from({ length: 20 }, (_, index) => ({
            title: `Channel ${index + 1}`,
            xtream_id: index + 1,
        }));
        selectedTypeContentLoading.set(false);
        selectedChannels.set(channels);
        fixture.detectChanges();

        const viewport = fixture.componentInstance.viewport();
        if (!viewport) {
            throw new Error('Expected virtual scroll viewport');
        }
        const scrollToIndex = jest.spyOn(viewport, 'scrollToIndex');

        selectedItem.set({ xtream_id: 16 });
        fixture.detectChanges();
        expect(scrollToIndex).toHaveBeenCalledWith(15, 'smooth');

        scrollToIndex.mockClear();
        fixture.componentRef.setInput('searchTermInput', 'Channel 16');
        fixture.detectChanges();

        expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('carries the live-channels pane id only outside the fullscreen panel copy', () => {
        // The category list's ArrowRight hand-off looks the pane up by id,
        // so the panel's second instance must not duplicate it.
        selectedTypeContentLoading.set(false);
        selectedChannels.set([{ title: 'Channel 1', xtream_id: 1 }]);
        fixture.detectChanges();
        const viewport = () =>
            fixture.nativeElement.querySelector(
                'cdk-virtual-scroll-viewport'
            ) as HTMLElement;
        expect(viewport().id).toBe('live-channels');
        expect(viewport().hasAttribute('tabindex')).toBe(true);

        fixture.componentRef.setInput('fullscreenPanelCopy', true);
        fixture.detectChanges();
        expect(viewport().hasAttribute('id')).toBe(false);
        expect(viewport().hasAttribute('tabindex')).toBe(true);
    });

    it('passes the live content type when toggling a channel favorite', async () => {
        selectedTypeContentLoading.set(false);
        currentPlaylist.set({
            id: 'playlist-1',
            password: 'secret',
            serverUrl: 'http://demo.example',
            username: 'demo',
        });

        fixture.detectChanges();

        fixture.componentInstance.toggleFavorite(new MouseEvent('click'), {
            title: 'Cartoon Network',
            xtream_id: 253,
        });
        await Promise.resolve();

        expect(storeSignals.toggleFavorite).toHaveBeenCalledWith(
            253,
            'playlist-1',
            'live'
        );
        expect(fixture.componentInstance.favorites.get('live:253')).toBe(true);
    });

    it('shares favorite toggles with the other list instances of the playlist', async () => {
        // The sidebar and the fullscreen channel panel each mount their own
        // instance; a heart toggled in one must flip in the other too.
        selectedTypeContentLoading.set(false);
        currentPlaylist.set({
            id: 'playlist-1',
            password: 'secret',
            serverUrl: 'http://demo.example',
            username: 'demo',
        });
        fixture.detectChanges();

        const marks = TestBed.inject(XtreamFavoriteMarksService);
        const published: unknown[] = [];
        marks.changes$.subscribe((change) => published.push(change));

        // A toggle here is announced to every instance.
        fixture.componentInstance.toggleFavorite(new MouseEvent('click'), {
            title: 'Cartoon Network',
            xtream_id: 253,
        });
        await Promise.resolve();
        expect(published).toEqual([
            { playlistId: 'playlist-1', key: 'live:253', isFavorite: true },
        ]);

        // A toggle announced by another instance lands here …
        marks.notify({
            playlistId: 'playlist-1',
            key: 'live:7',
            isFavorite: true,
        });
        expect(fixture.componentInstance.favorites.get('live:7')).toBe(true);
        marks.notify({
            playlistId: 'playlist-1',
            key: 'live:253',
            isFavorite: false,
        });
        expect(
            fixture.componentInstance.favorites.get('live:253')
        ).toBeUndefined();

        // … unless it belongs to another playlist.
        marks.notify({
            playlistId: 'playlist-2',
            key: 'live:9',
            isFavorite: true,
        });
        expect(
            fixture.componentInstance.favorites.get('live:9')
        ).toBeUndefined();
    });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from '@iptvnator/services';
import type { Channel } from '@iptvnator/shared/interfaces';
import {
    PlayerControlsComponent,
    WEB_PLAYER_SHARED_CONTROLS,
    WebVideoControlsAdapter,
} from '../player-controls';
import { SeriesPlaybackNavigationControlsComponent } from '../portal-inline-player/series-playback-navigation-controls.component';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import type { HtmlVideoPlayerComponent as HtmlVideoPlayerComponentInstance } from './html-video-player.component';

type HlsListener = (event: string, data: unknown) => void;

const lifecycle: string[] = [];
const hlsInstances: MockHls[] = [];

class MockHls {
    static readonly Events = {
        MANIFEST_PARSED: 'manifestParsed',
        ERROR: 'error',
        AUDIO_TRACKS_UPDATED: 'audioTracksUpdated',
        AUDIO_TRACK_SWITCHING: 'audioTrackSwitching',
        AUDIO_TRACK_SWITCHED: 'audioTrackSwitched',
        SUBTITLE_TRACKS_UPDATED: 'subtitleTracksUpdated',
        SUBTITLE_TRACKS_CLEARED: 'subtitleTracksCleared',
        SUBTITLE_TRACK_SWITCH: 'subtitleTrackSwitch',
        MANIFEST_LOADING: 'manifestLoading',
    };
    static readonly isSupported = jest.fn(() => true);

    readonly audioTracks = [{ name: 'English' }, { name: 'Deutsch' }];
    readonly subtitleTracks = [{ name: 'English CC' }];
    audioTrack = 0;
    subtitleTrack = 0;
    subtitleDisplay = true;
    private readonly listeners = new Map<string, Set<HlsListener>>();

    readonly on = jest.fn((event: string, listener: HlsListener) => {
        lifecycle.push(`on:${event}`);
        const listeners = this.listeners.get(event) ?? new Set<HlsListener>();
        listeners.add(listener);
        this.listeners.set(event, listeners);
    });
    readonly off = jest.fn((event: string, listener: HlsListener) => {
        lifecycle.push(`off:${event}`);
        this.listeners.get(event)?.delete(listener);
    });
    readonly attachMedia = jest.fn(() => lifecycle.push('attachMedia'));
    readonly loadSource = jest.fn(() => {
        lifecycle.push('loadSource');
        this.emit(MockHls.Events.MANIFEST_LOADING);
    });
    readonly destroy = jest.fn(() => lifecycle.push('hls:destroy'));

    constructor() {
        hlsInstances.push(this);
    }

    emit(event: string, data: unknown = {}): void {
        for (const listener of this.listeners.get(event) ?? []) {
            listener(event, data);
        }
    }
}

class MockMpegTsPlayer {
    readonly attachMediaElement = jest.fn();
    readonly on = jest.fn();
    readonly load = jest.fn();
    readonly pause = jest.fn();
    readonly unload = jest.fn();
    readonly detachMediaElement = jest.fn();
    readonly destroy = jest.fn();
}

const mpegTsCreatePlayer = jest.fn(() => new MockMpegTsPlayer());
const mpegTsIsSupported = jest.fn(() => false);

jest.unstable_mockModule('hls.js', () => ({ default: MockHls }));
jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: { ERROR: 'error' },
        createPlayer: mpegTsCreatePlayer,
        isSupported: mpegTsIsSupported,
    },
}));

const TEST_CHANNEL: Channel = {
    id: 'channel-1',
    url: 'https://example.test/live/playlist.m3u8',
    name: 'Test channel',
    group: { title: 'Test' },
    http: { origin: '', referrer: '', 'user-agent': '' },
    radio: 'false',
    tvg: { id: '', logo: '', name: '', rec: '', url: '' },
};

interface RenderOptions {
    channel?: Channel;
    interactionEnabled?: boolean;
    isLive?: boolean;
    seriesNavigation?: SeriesPlaybackNavigation | null;
    showCaptions?: boolean;
}

describe('HtmlVideoPlayerComponent shared controls', () => {
    let HtmlVideoPlayerComponent: typeof import('./html-video-player.component').HtmlVideoPlayerComponent;
    const fixtures: ComponentFixture<HtmlVideoPlayerComponentInstance>[] = [];

    beforeAll(async () => {
        ({ HtmlVideoPlayerComponent } =
            await import('./html-video-player.component'));
    });

    beforeEach(async () => {
        lifecycle.length = 0;
        hlsInstances.length = 0;
        MockHls.isSupported.mockReset().mockReturnValue(true);
        mpegTsIsSupported.mockReset().mockReturnValue(false);
        mpegTsCreatePlayer
            .mockReset()
            .mockImplementation(() => new MockMpegTsPlayer());
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { setUserAgent: jest.fn().mockResolvedValue(true) },
        });
        jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(
            undefined
        );
        jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(
            () => undefined
        );

        await TestBed.configureTestingModule({
            imports: [HtmlVideoPlayerComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: DataService,
                    useValue: {
                        sendIpcEvent: jest.fn().mockResolvedValue(undefined),
                    },
                },
                { provide: WEB_PLAYER_SHARED_CONTROLS, useValue: true },
            ],
        }).compileComponents();
    });

    afterEach(() => {
        for (const fixture of fixtures.splice(0)) {
            fixture.destroy();
        }
        delete (window as unknown as { electron?: unknown }).electron;
        jest.restoreAllMocks();
    });

    function render(options: RenderOptions = {}) {
        const fixture = TestBed.createComponent(HtmlVideoPlayerComponent);
        fixtures.push(fixture);
        if (options.channel) {
            fixture.componentRef.setInput('channel', options.channel);
        }
        fixture.componentRef.setInput(
            'interactionEnabled',
            options.interactionEnabled ?? true
        );
        fixture.componentRef.setInput('isLive', options.isLive ?? true);
        fixture.componentRef.setInput(
            'seriesNavigation',
            options.seriesNavigation ?? null
        );
        fixture.componentRef.setInput(
            'showCaptions',
            options.showCaptions ?? false
        );
        fixture.detectChanges();

        return {
            fixture,
            component: fixture.componentInstance,
            adapter: fixture.debugElement.injector.get(WebVideoControlsAdapter),
            controls: fixture.debugElement.query(
                By.directive(PlayerControlsComponent)
            )?.componentInstance as PlayerControlsComponent | undefined,
        };
    }

    it('uses one shared controls instance on the actual player shell', () => {
        const { fixture, controls } = render({
            seriesNavigation: {
                canPrevious: true,
                canNext: true,
                autoplayEnabled: true,
            },
        });
        const shell = fixture.debugElement.query(
            By.css('.html-video-player-shell')
        ).nativeElement;
        const video = fixture.debugElement.query(By.css('video'))
            .nativeElement as HTMLVideoElement;

        expect(video.controls).toBe(false);
        expect(
            fixture.debugElement.queryAll(By.directive(PlayerControlsComponent))
        ).toHaveLength(1);
        expect(
            fixture.debugElement.query(
                By.directive(SeriesPlaybackNavigationControlsComponent)
            )
        ).toBeNull();
        expect(controls?.playerSurface()).toBe(shell);
    });

    it('gates the shared surface and shortcuts with interaction availability', () => {
        const { fixture, controls } = render({ interactionEnabled: false });

        expect(controls?.showControls()).toBe(false);
        expect(controls?.shortcutsEnabled()).toBe(false);

        fixture.componentRef.setInput('interactionEnabled', true);
        fixture.detectChanges();

        expect(controls?.showControls()).toBe(true);
        expect(controls?.shortcutsEnabled()).toBe(true);
    });

    it('keeps series context reactive and forwards navigation outputs', () => {
        const setContext = jest.spyOn(
            WebVideoControlsAdapter.prototype,
            'setContext'
        );
        const { fixture, component, adapter, controls } = render({
            isLive: false,
        });
        const previous = jest.fn();
        const next = jest.fn();
        component.previousEpisodeRequested.subscribe(previous);
        component.nextEpisodeRequested.subscribe(next);

        expect(adapter.capabilities().seriesNavigation).toBe(false);
        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        fixture.detectChanges();

        expect(adapter.capabilities().seriesNavigation).toBe(true);
        expect(adapter.state().canPreviousEpisode).toBe(true);
        expect(adapter.state().canNextEpisode).toBe(false);
        controls?.previousEpisodeRequested.emit();
        controls?.nextEpisodeRequested.emit();
        expect(previous).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledTimes(1);
        expect(setContext).toHaveBeenCalledTimes(1);
    });

    it('retains an HLS source created before bridge initialization', () => {
        const { adapter } = render({
            channel: TEST_CHANNEL,
            isLive: false,
            showCaptions: true,
        });

        expect(hlsInstances).toHaveLength(1);
        expect(adapter.capabilities().audioTracks).toBe(true);
        expect(adapter.state().audioTracks).toEqual([
            { id: 0, label: 'English', selected: true },
            { id: 1, label: 'Deutsch', selected: false },
        ]);
    });

    it('binds HLS controls after media attach and before source loading', () => {
        const { component } = render();
        lifecycle.length = 0;

        component.playChannel(TEST_CHANNEL);

        const attachIndex = lifecycle.indexOf('attachMedia');
        const bindIndex = lifecycle.indexOf(
            `on:${MockHls.Events.AUDIO_TRACKS_UPDATED}`
        );
        const loadIndex = lifecycle.indexOf('loadSource');
        expect(attachIndex).toBeLessThan(bindIndex);
        expect(bindIndex).toBeLessThan(loadIndex);
    });

    it.each([false, true])(
        'passes authoritative isLive=%s to raw MPEG-TS playback',
        (isLive) => {
            mpegTsIsSupported.mockReturnValue(true);

            render({
                channel: {
                    ...TEST_CHANNEL,
                    url: 'https://example.test/raw.ts',
                },
                isLive,
            });

            expect(mpegTsCreatePlayer).toHaveBeenCalledWith({
                type: 'mpegts',
                isLive,
                url: 'https://example.test/raw.ts',
            });
        }
    );

    it('refreshes live and caption inputs through authoritative closures', () => {
        const { fixture, adapter } = render({
            channel: TEST_CHANNEL,
            isLive: true,
            showCaptions: false,
        });
        const hls = hlsInstances[0];

        expect(adapter.state().isLive).toBe(true);
        expect(hls.subtitleDisplay).toBe(false);

        fixture.componentRef.setInput('isLive', false);
        fixture.componentRef.setInput('showCaptions', true);
        fixture.detectChanges();

        expect(adapter.state().isLive).toBe(false);
        expect(hls.subtitleDisplay).toBe(true);
    });

    it('clears old HLS listeners and tracks before destroying the engine', () => {
        const { component, adapter } = render({
            channel: TEST_CHANNEL,
            isLive: false,
            showCaptions: true,
        });
        const hls = hlsInstances[0];
        lifecycle.length = 0;

        component.playChannel({
            ...TEST_CHANNEL,
            url: 'https://example.test/movie.mp4',
        });

        const destroyIndex = lifecycle.indexOf('hls:destroy');
        expect(destroyIndex).toBeGreaterThan(0);
        expect(
            lifecycle
                .slice(0, destroyIndex)
                .filter((event) => event.startsWith('off:'))
        ).toHaveLength(7);
        expect(hls.off).toHaveBeenCalledTimes(7);
        expect(adapter.state().audioTracks).toEqual([]);
        expect(adapter.state().subtitleTracks).toEqual([]);
    });

    it('destroys the bridge before HLS and detaches the adapter once', () => {
        const { component, adapter } = render({
            channel: TEST_CHANNEL,
            showCaptions: true,
        });
        const originalDetach = adapter.detach.bind(adapter);
        const detach = jest.spyOn(adapter, 'detach').mockImplementation(() => {
            lifecycle.push('adapter:detach');
            originalDetach();
        });
        lifecycle.length = 0;

        component.ngOnDestroy();
        component.ngOnDestroy();

        expect(detach).toHaveBeenCalledTimes(1);
        expect(lifecycle.indexOf('adapter:detach')).toBeLessThan(
            lifecycle.indexOf('hls:destroy')
        );
    });

    it('does not run legacy post-play caption suppression', async () => {
        const { component } = render();
        const disableCaptions = jest.spyOn(component, 'disableCaptions');

        component.handlePlayOperation();
        await Promise.resolve();

        expect(disableCaptions).not.toHaveBeenCalled();
    });
});

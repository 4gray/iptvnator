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
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import type { HtmlVideoPlayerComponent as HtmlVideoPlayerComponentInstance } from './html-video-player.component';

type HtmlVideoPlayerComponentType =
    typeof import('./html-video-player.component').HtmlVideoPlayerComponent;
type HlsListener = (event: string, data: unknown) => void;

export type SharedControlsFixture =
    ComponentFixture<HtmlVideoPlayerComponentInstance>;

export interface ControlsSource {
    kind: 'native' | 'mpegts' | 'hls' | 'shaka';
}

export interface HtmlPlayerInternals {
    controlsBridge: {
        setSource(source: ControlsSource): void;
    } | null;
    controlsSource: ControlsSource | null;
    hls: MockHls | null;
    mpegtsPlayer: MockMpegTsPlayer | null;
}

export interface RenderOptions {
    channel?: Channel;
    interactionEnabled?: boolean;
    isLive?: boolean;
    seriesNavigation?: SeriesPlaybackNavigation | null;
    showCaptions?: boolean;
}

export const lifecycle: string[] = [];
export const hlsInstances: MockHls[] = [];
export const mpegTsInstances: MockMpegTsPlayer[] = [];

export class MockHls {
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
    readonly attachMedia = jest.fn(() => lifecycle.push('hls:attachMedia'));
    readonly loadSource = jest.fn(() => {
        lifecycle.push('hls:loadSource');
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

export class MockMpegTsPlayer {
    readonly attachMediaElement = jest.fn(() =>
        lifecycle.push('mpegts:attachMedia')
    );
    readonly on = jest.fn();
    readonly load = jest.fn(() => lifecycle.push('mpegts:load'));
    readonly pause = jest.fn();
    readonly unload = jest.fn();
    readonly detachMediaElement = jest.fn();
    readonly destroy = jest.fn();

    constructor() {
        mpegTsInstances.push(this);
    }
}

export const mpegTsCreatePlayer = jest.fn(() => new MockMpegTsPlayer());
export const mpegTsIsSupported = jest.fn(() => false);

jest.unstable_mockModule('hls.js', () => ({ default: MockHls }));
jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: { ERROR: 'error' },
        createPlayer: mpegTsCreatePlayer,
        isSupported: mpegTsIsSupported,
    },
}));

export const TEST_CHANNEL: Channel = {
    id: 'channel-1',
    url: 'https://example.test/live/playlist.m3u8',
    name: 'Test channel',
    group: { title: 'Test' },
    http: { origin: '', referrer: '', 'user-agent': '' },
    radio: 'false',
    tvg: { id: '', logo: '', name: '', rec: '', url: '' },
};

export async function configureSharedControlsTests(
    HtmlVideoPlayerComponent: HtmlVideoPlayerComponentType
): Promise<void> {
    lifecycle.length = 0;
    hlsInstances.length = 0;
    mpegTsInstances.length = 0;
    MockHls.isSupported.mockReset().mockReturnValue(true);
    mpegTsIsSupported.mockReset().mockReturnValue(false);
    mpegTsCreatePlayer
        .mockReset()
        .mockImplementation(() => new MockMpegTsPlayer());
    Object.defineProperty(window, 'electron', {
        configurable: true,
        value: { setUserAgent: jest.fn().mockResolvedValue(true) },
    });
    jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
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
}

export function cleanupSharedControlsTests(
    fixtures: SharedControlsFixture[]
): void {
    for (const fixture of fixtures.splice(0)) {
        fixture.destroy();
    }
    delete (window as unknown as { electron?: unknown }).electron;
    jest.restoreAllMocks();
}

export function renderSharedControls(
    HtmlVideoPlayerComponent: HtmlVideoPlayerComponentType,
    fixtures: SharedControlsFixture[],
    options: RenderOptions = {}
) {
    const fixture = createFixture(HtmlVideoPlayerComponent, fixtures);
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
    return renderedFixture(fixture);
}

export function renderSharedControlsDefaults(
    HtmlVideoPlayerComponent: HtmlVideoPlayerComponentType,
    fixtures: SharedControlsFixture[]
) {
    const fixture = createFixture(HtmlVideoPlayerComponent, fixtures);
    fixture.detectChanges();
    return renderedFixture(fixture);
}

export function readHtmlPlayerInternals(
    component: HtmlVideoPlayerComponentInstance
): HtmlPlayerInternals {
    return component as unknown as HtmlPlayerInternals;
}

export function observeBridgeSourceBinding(
    component: HtmlVideoPlayerComponentInstance
) {
    const bridge = readHtmlPlayerInternals(component).controlsBridge;
    if (!bridge) {
        throw new Error('Expected initialized HTML player controls bridge');
    }
    const setSource = bridge.setSource.bind(bridge);
    return jest.spyOn(bridge, 'setSource').mockImplementation((source) => {
        lifecycle.push(`bridge:${source.kind}`);
        setSource(source);
    });
}

function createFixture(
    HtmlVideoPlayerComponent: HtmlVideoPlayerComponentType,
    fixtures: SharedControlsFixture[]
): SharedControlsFixture {
    const fixture = TestBed.createComponent(HtmlVideoPlayerComponent);
    fixtures.push(fixture);
    return fixture;
}

function renderedFixture(fixture: SharedControlsFixture) {
    return {
        fixture,
        component: fixture.componentInstance,
        adapter: fixture.debugElement.injector.get(WebVideoControlsAdapter),
        controls: fixture.debugElement.query(
            By.directive(PlayerControlsComponent)
        )?.componentInstance as PlayerControlsComponent | undefined,
    };
}

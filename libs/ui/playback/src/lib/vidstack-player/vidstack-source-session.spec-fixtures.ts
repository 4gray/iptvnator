import type { MediaProviderAdapter } from 'vidstack';
import type { ChannelDrm } from '@iptvnator/shared/interfaces';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import { WebVideoControlsAdapter } from '../player-controls';
import type { ShakaModuleLoader } from '../shaka-engine/shaka-module.types';
import type { VidstackSourceSession as VidstackSourceSessionInstance } from './vidstack-source-session';

/**
 * Engine mocks, fake Vidstack providers and session bootstrap for the
 * VidstackSourceSession specs. Importing this module registers the
 * hls.js/mpegts.js mocks, so it must be imported before
 * `initVidstackSourceSessionModule()` loads the session under test.
 */

export const mpegTsInstances: MockMpegTsPlayer[] = [];

export class MockHls {
    static Events = {
        MANIFEST_PARSED: 'manifestParsed',
        ERROR: 'error',
        AUDIO_TRACKS_UPDATED: 'audioTracksUpdated',
        AUDIO_TRACK_SWITCHING: 'audioTrackSwitching',
        AUDIO_TRACK_SWITCHED: 'audioTrackSwitched',
        SUBTITLE_TRACKS_UPDATED: 'subtitleTracksUpdated',
        SUBTITLE_TRACKS_CLEARED: 'subtitleTracksCleared',
        SUBTITLE_TRACK_SWITCH: 'subtitleTrackSwitch',
        MANIFEST_LOADING: 'manifestLoading',
        LEVELS_UPDATED: 'levelsUpdated',
        LEVEL_SWITCHED: 'levelSwitched',
    };

    static isSupported = jest.fn(() => true);

    readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    readonly on = jest.fn(
        (event: string, handler: (...args: unknown[]) => void) => {
            const handlers = this.handlers.get(event) ?? [];
            handlers.push(handler);
            this.handlers.set(event, handlers);
        }
    );
    readonly off = jest.fn(
        (event: string, handler: (...args: unknown[]) => void) => {
            const handlers = this.handlers.get(event) ?? [];
            this.handlers.set(
                event,
                handlers.filter((candidate) => candidate !== handler)
            );
        }
    );
    readonly destroy = jest.fn();
    audioTracks: Array<{ name?: string; lang?: string }> = [];
    audioTrack = 0;
    subtitleTracks: Array<{ name?: string; lang?: string }> = [];
    subtitleTrack = -1;
    subtitleDisplay = false;
    levels: unknown[] = [];

    emit(event: string, ...args: unknown[]): void {
        for (const handler of this.handlers.get(event) ?? []) {
            handler(...args);
        }
    }

    listenerCount(event: string): number {
        return this.handlers.get(event)?.length ?? 0;
    }
}

export class MockMpegTsPlayer {
    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    readonly attachMediaElement = jest.fn();
    readonly on = jest.fn(
        (event: string, handler: (...args: unknown[]) => void) => {
            this.handlers.set(event, handler);
        }
    );
    readonly off = jest.fn(
        (event: string, handler: (...args: unknown[]) => void) => {
            if (this.handlers.get(event) === handler) {
                this.handlers.delete(event);
            }
        }
    );
    readonly load = jest.fn();
    readonly play = jest.fn();
    readonly pause = jest.fn();
    readonly unload = jest.fn();
    readonly detachMediaElement = jest.fn();
    readonly destroy = jest.fn();
    mediaInfo: unknown = null;

    constructor() {
        mpegTsInstances.push(this);
    }
}

export const createMpegTsPlayer = jest.fn(() => new MockMpegTsPlayer());
export const isMpegTsSupported = jest.fn(() => true);

const actualHlsModule = jest.requireActual<typeof import('hls.js')>('hls.js');

jest.unstable_mockModule('hls.js', () => ({
    ...actualHlsModule,
    default: MockHls,
    ErrorDetails: actualHlsModule.ErrorDetails,
    ErrorTypes: actualHlsModule.ErrorTypes,
}));

jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: { ERROR: 'error' },
        createPlayer: createMpegTsPlayer,
        isSupported: isMpegTsSupported,
    },
}));

export interface FakeVideoProvider {
    readonly type: 'video';
    readonly video: HTMLVideoElement;
    currentSrc: unknown;
    loadSource: (src: unknown, preload?: string) => Promise<void>;
    readonly vendorLoadSource: jest.Mock;
}

export interface FakeHlsProvider {
    readonly type: 'hls';
    readonly video: HTMLVideoElement;
    currentSrc: unknown;
    library: unknown;
    config: Record<string, unknown>;
    readonly onInstance: jest.Mock;
    /** Simulates Vidstack creating its hls.js instance. */
    createInstance(): MockHls;
}

export function createFakeVideoProvider(): FakeVideoProvider {
    const vendorLoadSource = jest.fn(async () => undefined);
    return {
        type: 'video',
        video: document.createElement('video'),
        currentSrc: null,
        loadSource: vendorLoadSource,
        vendorLoadSource,
    };
}

export function createFakeHlsProvider(): FakeHlsProvider {
    const callbacks = new Set<(hls: MockHls) => void>();
    return {
        type: 'hls',
        video: document.createElement('video'),
        currentSrc: null,
        library: 'https://cdn.jsdelivr.net/npm/hls.js@^1.5.0/dist/hls.min.js',
        config: {},
        onInstance: jest.fn((callback: (hls: MockHls) => void) => {
            callbacks.add(callback);
            return () => callbacks.delete(callback);
        }),
        createInstance() {
            const hls = new MockHls();
            for (const callback of callbacks) {
                callback(hls);
            }
            return hls;
        },
    };
}

export function asProvider(
    provider: FakeVideoProvider | FakeHlsProvider
): MediaProviderAdapter {
    return provider as unknown as MediaProviderAdapter;
}

let sessionConstructor:
    | typeof import('./vidstack-source-session').VidstackSourceSession
    | undefined;
let resolveSource:
    | typeof import('./vidstack-player-setup').resolveVidstackSource
    | undefined;

/** Loads the session module after the engine mocks above are registered. */
export async function initVidstackSourceSessionModule(): Promise<void> {
    ({ VidstackSourceSession: sessionConstructor } = await import(
        './vidstack-source-session'
    ));
    ({ resolveVidstackSource: resolveSource } = await import(
        './vidstack-player-setup'
    ));
}

export function resetVidstackSourceFixtures(): void {
    mpegTsInstances.length = 0;
    createMpegTsPlayer
        .mockClear()
        .mockImplementation(() => new MockMpegTsPlayer());
    isMpegTsSupported.mockReset().mockReturnValue(true);
}

export function createSession({
    url,
    sharedControls,
    isLive = true,
    showCaptions = () => false,
    emitPlaybackIssue = () => undefined,
    getDrm,
    loadShaka,
}: {
    url: string;
    sharedControls: boolean;
    isLive?: boolean;
    showCaptions?: () => boolean;
    emitPlaybackIssue?: (issue: PlaybackDiagnostic) => void;
    getDrm?: () => ChannelDrm | undefined;
    loadShaka?: ShakaModuleLoader;
}): {
    session: VidstackSourceSessionInstance;
    adapter: WebVideoControlsAdapter;
} {
    if (!sessionConstructor || !resolveSource) {
        throw new Error('VidstackSourceSession test module is not initialized');
    }
    const adapter = new WebVideoControlsAdapter();
    return {
        session: new sessionConstructor({
            source: resolveSource(url),
            sharedControls,
            controlsAdapter: adapter,
            isLive: () => isLive,
            showCaptions,
            emitPlaybackIssue,
            getDrm,
            loadShaka,
        }),
        adapter,
    };
}

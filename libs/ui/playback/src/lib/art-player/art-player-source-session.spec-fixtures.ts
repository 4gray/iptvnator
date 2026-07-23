import type Artplayer from 'artplayer';
import type { ChannelDrm } from '@iptvnator/shared/interfaces';
import type { PlaybackDiagnostic } from '../playback-diagnostics/playback-diagnostics.util';
import { WebVideoControlsAdapter } from '../player-controls';
import type { ShakaModuleLoader } from '../shaka-engine/shaka-module.types';
import type { ArtPlayerSourceSession as ArtPlayerSourceSessionInstance } from './art-player-source-session';

/**
 * Shared engine mocks and session bootstrap for the ArtPlayerSourceSession
 * spec files. Importing this module registers the hls.js/mpegts.js module
 * mocks, so it must be imported before `initArtPlayerSourceSessionModule()`
 * dynamically loads the session under test.
 */

export const hlsInstances: MockHls[] = [];
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
    readonly attachMedia = jest.fn();
    readonly loadSource = jest.fn();
    readonly destroy = jest.fn();
    audioTracks: Array<{ name?: string; lang?: string }> = [];
    audioTrack = 0;
    subtitleTracks: Array<{ name?: string; lang?: string }> = [];
    subtitleTrack = -1;
    subtitleDisplay = false;

    constructor() {
        hlsInstances.push(this);
    }

    emit(event: string, ...args: unknown[]): void {
        for (const handler of this.handlers.get(event) ?? []) {
            handler(...args);
        }
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
    readonly play = jest.fn(() => undefined as Promise<void> | void);
    readonly pause = jest.fn();
    readonly unload = jest.fn();
    readonly detachMediaElement = jest.fn();
    readonly destroy = jest.fn();

    constructor() {
        mpegTsInstances.push(this);
    }
}

export const createMpegTsPlayer = jest.fn(() => new MockMpegTsPlayer());

jest.unstable_mockModule('hls.js', () => ({
    default: MockHls,
}));

jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: { ERROR: 'error' },
        createPlayer: createMpegTsPlayer,
        isSupported: jest.fn(() => true),
    },
}));

let sessionConstructor:
    | typeof import('./art-player-source-session').ArtPlayerSourceSession
    | undefined;

/** Loads the session module after the engine mocks above are registered. */
export async function initArtPlayerSourceSessionModule(): Promise<void> {
    ({ ArtPlayerSourceSession: sessionConstructor } = await import(
        './art-player-source-session'
    ));
}

export function resetArtPlayerSourceFixtures(): void {
    hlsInstances.length = 0;
    mpegTsInstances.length = 0;
    createMpegTsPlayer
        .mockClear()
        .mockImplementation(() => new MockMpegTsPlayer());
    MockHls.isSupported.mockReturnValue(true);
}

export function createSession({
    sharedControls,
    isLive = true,
    emitPlaybackIssue = () => undefined,
    getDrm,
    loadShaka,
}: {
    sharedControls: boolean;
    isLive?: boolean;
    emitPlaybackIssue?: (issue: PlaybackDiagnostic) => void;
    getDrm?: () => ChannelDrm | undefined;
    loadShaka?: ShakaModuleLoader;
}): {
    session: ArtPlayerSourceSessionInstance;
    player: Artplayer;
    video: HTMLVideoElement;
    adapter: WebVideoControlsAdapter;
    settingAdd: jest.Mock;
} {
    const video = document.createElement('video');
    const settingAdd = jest.fn();
    const player = {
        video,
        setting: { add: settingAdd },
    } as unknown as Artplayer;
    const adapter = new WebVideoControlsAdapter();
    const Session = requireSessionConstructor();

    return {
        session: new Session({
            sharedControls,
            controlsAdapter: adapter,
            isLive: () => isLive,
            showCaptions: () => false,
            emitPlaybackIssue,
            getDrm,
            loadShaka,
        }),
        player,
        video,
        adapter,
        settingAdd,
    };
}

function requireSessionConstructor(): typeof import('./art-player-source-session').ArtPlayerSourceSession {
    if (!sessionConstructor) {
        throw new Error(
            'ArtPlayerSourceSession test module is not initialized'
        );
    }
    return sessionConstructor;
}

export function createTimeRanges(ends: number[]): TimeRanges {
    return {
        length: ends.length,
        start: () => 0,
        end: (index: number) => ends[index],
    };
}

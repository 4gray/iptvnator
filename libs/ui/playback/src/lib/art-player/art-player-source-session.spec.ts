import type Artplayer from 'artplayer';
import type { ChannelDrm } from '@iptvnator/shared/interfaces';
import type { PlaybackDiagnostic } from '../playback-diagnostics/playback-diagnostics.util';
import { WebVideoControlsAdapter } from '../player-controls';
import type {
    ShakaModuleLike,
    ShakaModuleLoader,
} from '../shaka-engine/shaka-module.types';
import type { ArtPlayerSourceSession as ArtPlayerSourceSessionInstance } from './art-player-source-session';

const hlsInstances: MockHls[] = [];
const mpegTsInstances: MockMpegTsPlayer[] = [];

class MockHls {
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

class MockMpegTsPlayer {
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

const createMpegTsPlayer = jest.fn(() => new MockMpegTsPlayer());

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

describe('ArtPlayerSourceSession', () => {
    let ArtPlayerSourceSession: typeof import('./art-player-source-session').ArtPlayerSourceSession;

    beforeAll(async () => {
        ({ ArtPlayerSourceSession } =
            await import('./art-player-source-session'));
        sessionConstructor = ArtPlayerSourceSession;
    });

    beforeEach(() => {
        hlsInstances.length = 0;
        mpegTsInstances.length = 0;
        createMpegTsPlayer.mockClear();
        MockHls.isSupported.mockReturnValue(true);
    });

    it('binds HLS tracks to shared controls and tears every listener down exactly', () => {
        const { session, player, video, adapter } = createSession({
            sharedControls: true,
        });
        const attach = jest.spyOn(adapter, 'attach');
        const detach = jest.spyOn(adapter, 'detach');
        session.attach(player);
        detach.mockClear();

        session.customType['m3u8']?.(
            video,
            'https://example.test/live.m3u8',
            player
        );

        const hls = hlsInstances[0];
        hls.audioTracks = [{ name: 'Main' }, { name: 'Alternate' }];
        hls.emit(MockHls.Events.AUDIO_TRACKS_UPDATED);

        expect(attach).toHaveBeenCalledWith(
            video,
            expect.objectContaining({
                getAudioTracks: expect.any(Function),
                getSubtitleTracks: expect.any(Function),
            })
        );
        expect(adapter.capabilities().audioTracks).toBe(true);
        expect(hls.attachMedia).toHaveBeenCalledWith(video);
        expect(hls.loadSource).toHaveBeenCalledWith(
            'https://example.test/live.m3u8'
        );

        session.destroy();

        expect(detach).toHaveBeenCalledTimes(1);
        expect(hls.off).toHaveBeenCalledWith(
            MockHls.Events.MANIFEST_PARSED,
            expect.any(Function)
        );
        expect(hls.off).toHaveBeenCalledWith(
            MockHls.Events.ERROR,
            expect.any(Function)
        );
        expect(hls.off).toHaveBeenCalledWith(
            MockHls.Events.AUDIO_TRACKS_UPDATED,
            expect.any(Function)
        );
        expect(hls.destroy).toHaveBeenCalledTimes(1);
    });

    it('keeps the legacy HLS audio menu and does not attach shared controls', () => {
        const { session, player, video, adapter, settingAdd } = createSession({
            sharedControls: false,
        });
        const attach = jest.spyOn(adapter, 'attach');
        session.attach(player);

        session.customType['m3u8']?.(
            video,
            'https://example.test/live.m3u8',
            player
        );
        const hls = hlsInstances[0];
        hls.audioTracks = [{ name: 'Main' }, { name: 'Alternate' }];
        hls.emit(MockHls.Events.AUDIO_TRACKS_UPDATED);

        expect(settingAdd).toHaveBeenCalledTimes(1);
        expect(attach).not.toHaveBeenCalled();
    });

    it('uses authoritative VOD metadata for shared MPEG-TS and catches autoplay rejection', async () => {
        const { session, player, video, adapter } = createSession({
            sharedControls: true,
            isLive: false,
        });
        const rejectedPlay = Promise.reject(new Error('autoplay blocked'));
        const engine = new MockMpegTsPlayer();
        engine.play.mockReturnValue(rejectedPlay);
        createMpegTsPlayer.mockReturnValueOnce(engine);
        Object.defineProperty(video, 'duration', {
            configurable: true,
            value: Number.POSITIVE_INFINITY,
        });
        Object.defineProperty(video, 'seekable', {
            configurable: true,
            value: createTimeRanges([135]),
        });
        session.attach(player);

        session.customType['ts']?.(
            video,
            'https://example.test/movie.ts',
            player
        );
        await rejectedPlay.catch(() => undefined);

        expect(createMpegTsPlayer).toHaveBeenCalledWith({
            type: 'mpegts',
            isLive: false,
            url: 'https://example.test/movie.ts',
        });
        expect(adapter.state()).toEqual(
            expect.objectContaining({
                isLive: false,
                durationSeconds: 135,
            })
        );
        expect(session.resolveDuration(Number.POSITIVE_INFINITY)).toBe(135);
        expect(engine.attachMediaElement).toHaveBeenCalledWith(video);
        expect(engine.load).toHaveBeenCalledTimes(1);
        expect(engine.play).toHaveBeenCalledTimes(1);
    });

    it('preserves legacy live MPEG-TS semantics when the rollout flag is off', () => {
        const { session, player, video } = createSession({
            sharedControls: false,
            isLive: false,
        });
        session.attach(player);

        session.customType['ts']?.(
            video,
            'https://example.test/movie.ts',
            player
        );

        expect(createMpegTsPlayer).toHaveBeenCalledWith({
            type: 'mpegts',
            isLive: true,
            url: 'https://example.test/movie.ts',
        });
    });

    it('reports HLS and MPEG-TS diagnostics from the session-local source', () => {
        const emitted: PlaybackDiagnostic[] = [];
        const { session, player, video } = createSession({
            sharedControls: true,
            emitPlaybackIssue: (issue) => emitted.push(issue),
        });
        session.attach(player);

        session.customType['m3u8']?.(
            video,
            'https://example.test/live.m3u8',
            player
        );
        const staleHlsError = hlsInstances[0].handlers.get(
            MockHls.Events.ERROR
        )?.[0];
        hlsInstances[0].emit(MockHls.Events.ERROR, null, {
            type: 'mediaError',
            details: 'bufferAddCodecError',
            fatal: true,
            error: new Error('unsupported codec'),
        });

        session.customType['ts']?.(
            video,
            'https://example.test/live.ts',
            player
        );
        staleHlsError?.(null, {
            type: 'networkError',
            details: 'stale callback',
            fatal: true,
        });
        mpegTsInstances.at(-1)?.handlers.get('error')?.(
            'mediaError',
            'unsupported codec',
            {}
        );

        expect(emitted).toEqual([
            expect.objectContaining({
                source: 'hls',
                sourceUrl: 'https://example.test/live.m3u8',
                player: 'artplayer',
            }),
            expect.objectContaining({
                source: 'mpegts',
                sourceUrl: 'https://example.test/live.ts',
                player: 'artplayer',
            }),
        ]);
    });

    it('ignores a delayed customType callback after its player was destroyed', () => {
        const { session, player, video } = createSession({
            sharedControls: true,
        });
        session.attach(player);
        session.destroy();

        session.customType['m3u8']?.(
            video,
            'https://example.test/stale.m3u8',
            player
        );
        session.customType['ts']?.(
            video,
            'https://example.test/stale.ts',
            player
        );

        expect(hlsInstances).toHaveLength(0);
        expect(createMpegTsPlayer).not.toHaveBeenCalled();
    });

    it('refreshes caption inputs only through the active shared bridge', () => {
        const { session, player, adapter } = createSession({
            sharedControls: true,
        });
        const refresh = jest.spyOn(adapter, 'refresh');
        session.attach(player);
        refresh.mockClear();

        session.refreshInputs();

        expect(refresh).toHaveBeenCalled();
    });

    it('starts the Shaka engine with channel DRM for the mpd custom type', async () => {
        const fakeShaka = createFakeShakaModule();
        const drm: ChannelDrm = {
            licenseType: 'clearkey',
            supported: true,
            clearKeys: { abc: 'def' },
        };
        const { session, player, video } = createSession({
            sharedControls: true,
            getDrm: () => drm,
            loadShaka: fakeShaka.loader,
        });
        session.attach(player);

        session.customType['mpd']?.(
            video,
            'https://example.test/live.mpd',
            player
        );
        await flushAsync();

        expect(fakeShaka.loader).toHaveBeenCalledTimes(1);
        expect(fakeShaka.instances).toHaveLength(1);
        expect(fakeShaka.instances[0].attachedTo).toBe(video);
        expect(fakeShaka.instances[0].loadedUrls).toEqual([
            'https://example.test/live.mpd',
        ]);
        expect(fakeShaka.instances[0].configureCalls).toEqual([
            { drm: { clearKeys: { abc: 'def' } } },
        ]);
        expect(hlsInstances).toHaveLength(0);
        expect(mpegTsInstances).toHaveLength(0);
    });

    it('destroys the Shaka engine when the source changes or the session dies', async () => {
        const fakeShaka = createFakeShakaModule();
        const { session, player, video } = createSession({
            sharedControls: false,
            loadShaka: fakeShaka.loader,
        });
        session.attach(player);

        session.customType['mpd']?.(
            video,
            'https://example.test/live.mpd',
            player
        );
        await flushAsync();
        session.customType['m3u8']?.(
            video,
            'https://example.test/live.m3u8',
            player
        );
        await flushAsync();

        expect(fakeShaka.instances[0].destroyCount).toBe(1);
        expect(hlsInstances).toHaveLength(1);

        session.destroy();
        await flushAsync();
        expect(fakeShaka.instances).toHaveLength(1);
    });
});

async function flushAsync(): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
    }
}

interface FakeShakaPlayerInstance {
    attachedTo: HTMLMediaElement | null;
    loadedUrls: string[];
    configureCalls: Record<string, unknown>[];
    destroyCount: number;
}

function createFakeShakaModule(): {
    loader: jest.Mock;
    instances: FakeShakaPlayerInstance[];
} {
    const instances: FakeShakaPlayerInstance[] = [];

    class FakePlayer {
        static isBrowserSupported = () => true;
        attachedTo: HTMLMediaElement | null = null;
        loadedUrls: string[] = [];
        configureCalls: Record<string, unknown>[] = [];
        destroyCount = 0;

        constructor() {
            instances.push(this);
        }

        attach(mediaElement: HTMLMediaElement): Promise<unknown> {
            this.attachedTo = mediaElement;
            return Promise.resolve();
        }
        configure(config: Record<string, unknown>): boolean {
            this.configureCalls.push(config);
            return true;
        }
        load(assetUri: string): Promise<unknown> {
            this.loadedUrls.push(assetUri);
            return Promise.resolve();
        }
        destroy(): Promise<unknown> {
            this.destroyCount += 1;
            return Promise.resolve();
        }
        addEventListener(): void {}
        removeEventListener(): void {}
        getAudioTracks() {
            return [];
        }
        selectAudioTrack(): void {}
        getTextTracks() {
            return [];
        }
        selectTextTrack(): void {}
        setTextTrackVisibility(): void {}
        isTextVisible(): boolean {
            return false;
        }
        isLive(): boolean {
            return false;
        }
    }

    const module = {
        Player: FakePlayer,
        polyfill: { installAll: () => undefined },
    } as unknown as ShakaModuleLike;

    return {
        loader: jest.fn().mockResolvedValue(module),
        instances,
    };
}

function createSession({
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

let sessionConstructor:
    | typeof import('./art-player-source-session').ArtPlayerSourceSession
    | undefined;

function requireSessionConstructor(): typeof import('./art-player-source-session').ArtPlayerSourceSession {
    if (!sessionConstructor) {
        throw new Error(
            'ArtPlayerSourceSession test module is not initialized'
        );
    }
    return sessionConstructor;
}

function createTimeRanges(ends: number[]): TimeRanges {
    return {
        length: ends.length,
        start: () => 0,
        end: (index: number) => ends[index],
    };
}

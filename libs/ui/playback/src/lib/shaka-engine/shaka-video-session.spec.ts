import type { ChannelDrm } from '@iptvnator/shared/interfaces';
import {
    InlinePlaybackPlayer,
    PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '../playback-diagnostics/playback-diagnostics.model';
import type {
    ShakaModuleLike,
    ShakaPlayerLike,
} from './shaka-module.types';
import { ShakaVideoSession } from './shaka-video-session';

type Listener = (event: Event) => void;

class FakeShakaPlayer implements ShakaPlayerLike {
    static instances: FakeShakaPlayer[] = [];
    readonly configureCalls: Record<string, unknown>[] = [];
    readonly listeners = new Map<string, Set<Listener>>();
    readonly selectTextTrackCalls: unknown[] = [];
    attachedTo: HTMLMediaElement | null = null;
    loadedUrls: string[] = [];
    destroyCount = 0;
    loadResult: Promise<unknown> = Promise.resolve();

    constructor() {
        FakeShakaPlayer.instances.push(this);
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
        return this.loadResult;
    }

    destroy(): Promise<unknown> {
        this.destroyCount += 1;
        return Promise.resolve();
    }

    addEventListener(type: string, listener: Listener): void {
        const set = this.listeners.get(type) ?? new Set<Listener>();
        set.add(listener);
        this.listeners.set(type, set);
    }

    removeEventListener(type: string, listener: Listener): void {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type: string, detail?: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) {
            listener({ type, detail } as unknown as Event);
        }
    }

    getAudioTracks() {
        return [];
    }
    selectAudioTrack(): void {}
    getTextTracks() {
        return [];
    }
    selectTextTrack(track: unknown): void {
        this.selectTextTrackCalls.push(track);
    }
    isLive(): boolean {
        return false;
    }
}

const flush = async (): Promise<void> => {
    for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
    }
};

describe('ShakaVideoSession', () => {
    const video = {} as HTMLVideoElement;
    let issues: PlaybackDiagnostic[];
    let installAll: jest.Mock;
    let browserSupported: boolean;
    let loadShaka: jest.Mock;
    let fakeModule: ShakaModuleLike;

    const createSession = () =>
        new ShakaVideoSession({
            player: InlinePlaybackPlayer.Html5,
            emitPlaybackIssue: (issue) => issues.push(issue),
            showCaptions: () => false,
            loadShaka,
        });

    beforeEach(() => {
        FakeShakaPlayer.instances = [];
        issues = [];
        browserSupported = true;
        installAll = jest.fn();
        fakeModule = {
            Player: Object.assign(
                function (this: unknown) {
                    return new FakeShakaPlayer();
                } as unknown as ShakaModuleLike['Player'],
                { isBrowserSupported: () => browserSupported }
            ),
            polyfill: { installAll },
        };
        loadShaka = jest.fn().mockResolvedValue(fakeModule);
    });

    it('lazily loads the module once, installs polyfills and starts playback', async () => {
        const session = createSession();
        session.start(video, 'http://example.com/a.mpd');
        await flush();
        session.start(video, 'http://example.com/b.mpd');
        await flush();

        expect(loadShaka).toHaveBeenCalledTimes(1);
        expect(installAll).toHaveBeenCalledTimes(1);
        const [first, second] = FakeShakaPlayer.instances;
        expect(first.attachedTo).toBe(video);
        expect(first.loadedUrls).toEqual(['http://example.com/a.mpd']);
        expect(first.destroyCount).toBe(1);
        expect(second.loadedUrls).toEqual(['http://example.com/b.mpd']);
        expect(issues).toEqual([]);
    });

    it('configures ClearKey keys before load for supported DRM', async () => {
        const drm: ChannelDrm = {
            licenseType: 'clearkey',
            supported: true,
            clearKeys: { abc: 'def' },
        };
        const session = createSession();
        session.start(video, 'http://example.com/enc.mpd', drm);
        await flush();

        const player = FakeShakaPlayer.instances[0];
        expect(player.configureCalls).toEqual([
            { drm: { clearKeys: { abc: 'def' } } },
        ]);
        expect(player.loadedUrls).toEqual(['http://example.com/enc.mpd']);
    });

    it('starts without DRM config for clear DASH channels', async () => {
        const session = createSession();
        session.start(video, 'http://example.com/clear.mpd');
        await flush();

        expect(FakeShakaPlayer.instances[0].configureCalls).toEqual([]);
        expect(issues).toEqual([]);
    });

    it('emits a DRM diagnostic and starts no engine for unsupported license types', async () => {
        const session = createSession();
        session.start(video, 'http://example.com/wv.mpd', {
            licenseType: 'com.widevine.alpha',
            supported: false,
        });
        await flush();

        expect(loadShaka).not.toHaveBeenCalled();
        expect(FakeShakaPlayer.instances).toHaveLength(0);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(PlaybackDiagnosticCode.DrmOrEncryption);
        expect(issues[0].source).toBe(PlaybackDiagnosticSource.Shaka);
        expect(issues[0].details).toContain('com.widevine.alpha');
    });

    it('classifies critical shaka error events and ignores recoverable ones', async () => {
        const session = createSession();
        session.start(video, 'http://example.com/a.mpd');
        await flush();

        const player = FakeShakaPlayer.instances[0];
        player.dispatch('error', { severity: 1, category: 1, code: 1002 });
        expect(issues).toEqual([]);

        player.dispatch('error', { severity: 2, category: 6, code: 6001 });
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(PlaybackDiagnosticCode.DrmOrEncryption);
    });

    it('emits a classified diagnostic when load rejects with a shaka error', async () => {
        const loadError = { severity: 2, category: 4, code: 4001 };
        loadShaka.mockResolvedValue({
            ...fakeModule,
            Player: Object.assign(
                function (this: unknown) {
                    const player = new FakeShakaPlayer();
                    player.loadResult = Promise.reject(loadError);
                    return player;
                } as unknown as ShakaModuleLike['Player'],
                { isBrowserSupported: () => true }
            ),
        });

        const session = createSession();
        session.start(video, 'http://example.com/bad.mpd');
        await flush();

        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(
            PlaybackDiagnosticCode.UnsupportedContainer
        );
        expect(issues[0].sourceUrl).toBe('http://example.com/bad.mpd');
    });

    it('suppresses interrupted loads and stale results after a channel switch', async () => {
        let resolveLoad: () => void = () => undefined;
        loadShaka.mockResolvedValue({
            ...fakeModule,
            Player: Object.assign(
                function (this: unknown) {
                    const player = new FakeShakaPlayer();
                    if (FakeShakaPlayer.instances.length === 1) {
                        player.loadResult = new Promise<unknown>((resolve) => {
                            resolveLoad = () => resolve(undefined);
                        });
                    }
                    return player;
                } as unknown as ShakaModuleLike['Player'],
                { isBrowserSupported: () => true }
            ),
        });

        const session = createSession();
        session.start(video, 'http://example.com/slow.mpd');
        await flush();
        session.start(video, 'http://example.com/fast.mpd');
        resolveLoad();
        await flush();

        const [slow, fast] = FakeShakaPlayer.instances;
        expect(slow.destroyCount).toBe(1);
        expect(fast.loadedUrls).toEqual(['http://example.com/fast.mpd']);
        // The slow player resolved after being superseded; its post-load
        // caption suppression must not have been applied.
        expect(slow.selectTextTrackCalls).toEqual([]);
        expect(fast.selectTextTrackCalls).toEqual([null]);
        expect(issues).toEqual([]);
    });

    it('emits an unsupported-container diagnostic when the browser lacks MSE/EME', async () => {
        browserSupported = false;
        const session = createSession();
        session.start(video, 'http://example.com/a.mpd');
        await flush();

        expect(FakeShakaPlayer.instances).toHaveLength(0);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(
            PlaybackDiagnosticCode.UnsupportedContainer
        );
    });

    it('destroy tears down the engine and blocks later starts', async () => {
        const session = createSession();
        session.start(video, 'http://example.com/a.mpd');
        await flush();
        session.destroy();
        await flush();
        session.start(video, 'http://example.com/b.mpd');
        await flush();

        expect(FakeShakaPlayer.instances).toHaveLength(1);
        expect(FakeShakaPlayer.instances[0].destroyCount).toBe(1);
    });
});

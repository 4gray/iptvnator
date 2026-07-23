import type { ChannelDrm } from '@iptvnator/shared/interfaces';
import {
    InlinePlaybackPlayer,
    PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '../playback-diagnostics/playback-diagnostics.model';
import {
    FakeShakaPlayer,
    createFakeShakaEnvironment,
    flushShakaMicrotasks as flush,
} from './shaka-player-test-double';
import { ShakaVideoSession } from './shaka-video-session';

describe('ShakaVideoSession', () => {
    const video = {} as HTMLVideoElement;
    let issues: PlaybackDiagnostic[];

    const createSession = (
        environment: ReturnType<typeof createFakeShakaEnvironment>
    ) =>
        new ShakaVideoSession({
            player: InlinePlaybackPlayer.Html5,
            emitPlaybackIssue: (issue) => issues.push(issue),
            showCaptions: () => false,
            loadShaka: environment.loader,
        });

    beforeEach(() => {
        issues = [];
    });

    it('lazily loads the module once, installs polyfills and starts playback', async () => {
        const environment = createFakeShakaEnvironment();
        const session = createSession(environment);
        session.start(video, 'http://example.com/a.mpd');
        await flush();
        session.start(video, 'http://example.com/b.mpd');
        await flush();

        expect(environment.loaderCalls).toBe(1);
        expect(environment.installAllCalls).toBe(1);
        const [first, second] = environment.instances;
        expect(first.attachedTo).toBe(video);
        expect(first.loadedUrls).toEqual(['http://example.com/a.mpd']);
        expect(first.destroyCount).toBe(1);
        expect(second.loadedUrls).toEqual(['http://example.com/b.mpd']);
        expect(issues).toEqual([]);
    });

    it('configures ClearKey keys before load for supported DRM', async () => {
        const environment = createFakeShakaEnvironment();
        const drm: ChannelDrm = {
            licenseType: 'clearkey',
            supported: true,
            clearKeys: { abc: 'def' },
        };
        const session = createSession(environment);
        session.start(video, 'http://example.com/enc.mpd', drm);
        await flush();

        const player = environment.instances[0];
        expect(player.configureCalls).toEqual([
            { drm: { clearKeys: { abc: 'def' } } },
        ]);
        expect(player.loadedUrls).toEqual(['http://example.com/enc.mpd']);
    });

    it('starts without DRM config for clear DASH channels', async () => {
        const environment = createFakeShakaEnvironment();
        const session = createSession(environment);
        session.start(video, 'http://example.com/clear.mpd');
        await flush();

        expect(environment.instances[0].configureCalls).toEqual([]);
        expect(issues).toEqual([]);
    });

    it('emits a DRM diagnostic and starts no engine for unsupported license types', async () => {
        const environment = createFakeShakaEnvironment();
        const session = createSession(environment);
        session.start(video, 'http://example.com/wv.mpd', {
            licenseType: 'com.widevine.alpha',
            supported: false,
        });
        await flush();

        expect(environment.loaderCalls).toBe(0);
        expect(environment.instances).toHaveLength(0);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(PlaybackDiagnosticCode.DrmOrEncryption);
        expect(issues[0].source).toBe(PlaybackDiagnosticSource.Shaka);
        expect(issues[0].details).toContain('com.widevine.alpha');
    });

    it('classifies critical shaka error events and ignores recoverable ones', async () => {
        const environment = createFakeShakaEnvironment();
        const session = createSession(environment);
        session.start(video, 'http://example.com/a.mpd');
        await flush();

        const player = environment.instances[0];
        player.dispatch('error', { severity: 1, category: 1, code: 1002 });
        expect(issues).toEqual([]);
        expect(session.getPlayer()).toBe(player);

        player.dispatch('error', { severity: 2, category: 6, code: 6001 });
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(PlaybackDiagnosticCode.DrmOrEncryption);
        // Critical errors end playback: the dead engine must be torn down.
        expect(player.destroyCount).toBe(1);
        expect(session.getPlayer()).toBeNull();
    });

    it('emits a diagnostic and tears the engine down when load rejects', async () => {
        const loadError = { severity: 2, category: 4, code: 4001 };
        const environment = createFakeShakaEnvironment({
            onCreate: (player) => {
                player.loadResult = Promise.reject(loadError);
            },
        });
        const session = createSession(environment);
        session.start(video, 'http://example.com/bad.mpd');
        await flush();

        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(
            PlaybackDiagnosticCode.UnsupportedContainer
        );
        expect(issues[0].sourceUrl).toBe('http://example.com/bad.mpd');
        // The failed engine must not stay attached or exposed to controls.
        expect(environment.instances[0].destroyCount).toBe(1);
        expect(session.getPlayer()).toBeNull();
    });

    it('recovers from a stalled load: stop() interrupts it and the next start proceeds', async () => {
        const environment = createFakeShakaEnvironment({
            onCreate: (player, index) => {
                if (index === 0) {
                    player.stallNextLoad = true;
                }
            },
        });
        const session = createSession(environment);
        session.start(video, 'http://example.com/stalled.mpd');
        await flush();
        expect(environment.instances[0].loadedUrls).toEqual([
            'http://example.com/stalled.mpd',
        ]);

        session.stop();
        session.start(video, 'http://example.com/next.mpd');
        await flush();

        const [stalled, next] = environment.instances;
        expect(stalled.destroyCount).toBe(1);
        expect(next.loadedUrls).toEqual(['http://example.com/next.mpd']);
        expect(session.getPlayer()).toBe(next);
        expect(issues).toEqual([]);
    });

    it('suppresses interrupted loads and stale results after a channel switch', async () => {
        let releaseFirstLoad: () => void = () => undefined;
        const environment = createFakeShakaEnvironment({
            onCreate: (player, index) => {
                if (index === 0) {
                    player.loadResult = new Promise<unknown>((resolve) => {
                        releaseFirstLoad = () => resolve(undefined);
                    });
                }
            },
        });
        const session = createSession(environment);
        session.start(video, 'http://example.com/slow.mpd');
        await flush();
        session.start(video, 'http://example.com/fast.mpd');
        releaseFirstLoad();
        await flush();

        const [slow, fast] = environment.instances as [
            FakeShakaPlayer,
            FakeShakaPlayer,
        ];
        expect(slow.destroyCount).toBe(1);
        expect(fast.loadedUrls).toEqual(['http://example.com/fast.mpd']);
        // The slow player resolved after being superseded; its post-load
        // caption suppression must not have been applied.
        expect(slow.selectTextTrackCalls).toEqual([]);
        expect(fast.selectTextTrackCalls).toEqual([null]);
        expect(issues).toEqual([]);
    });

    it('emits an unsupported-container diagnostic when the browser lacks MSE/EME', async () => {
        const environment = createFakeShakaEnvironment();
        environment.browserSupported = false;
        const session = createSession(environment);
        session.start(video, 'http://example.com/a.mpd');
        await flush();

        expect(environment.instances).toHaveLength(0);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(
            PlaybackDiagnosticCode.UnsupportedContainer
        );
    });

    it('destroy tears down the engine and blocks later starts', async () => {
        const environment = createFakeShakaEnvironment();
        const session = createSession(environment);
        session.start(video, 'http://example.com/a.mpd');
        await flush();
        session.destroy();
        await flush();
        session.start(video, 'http://example.com/b.mpd');
        await flush();

        expect(environment.instances).toHaveLength(1);
        expect(environment.instances[0].destroyCount).toBe(1);
    });
});

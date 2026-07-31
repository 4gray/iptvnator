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
        expect(issues[0].details).toBe('Unsupported DRM license configuration');
        expect(JSON.stringify(issues[0])).not.toContain('com.widevine.alpha');
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
        expect(issues[0].shaka).toEqual({
            severity: 'critical',
            category: 'drm',
            engineCode: 6001,
            disposition: 'terminal',
            stage: 'unknown',
            failure: 'drm',
        });
        // Without KODIPROP config the DRM hint may still help externally.
        expect(issues[0].externalFallbackRecommended).toBe(true);
        // Critical errors end playback: the dead engine must be torn down.
        expect(player.destroyCount).toBe(1);
        expect(session.getPlayer()).toBeNull();
    });

    it('ignores error events whose public severity does not prove terminal state', async () => {
        const environment = createFakeShakaEnvironment();
        const session = createSession(environment);
        session.start(video, 'http://example.com/a.mpd');
        await flush();

        const player = environment.instances[0];
        player.dispatch('error', {
            severity: 99,
            category: 1,
            code: 1002,
            message: 'CORS codec license provider guess',
        });

        expect(issues).toEqual([]);
        expect(player.destroyCount).toBe(0);
        expect(session.getPlayer()).toBe(player);
    });

    it('drops the external-fallback hint for every failure on ClearKey channels', async () => {
        const environment = createFakeShakaEnvironment();
        const session = createSession(environment);
        session.start(video, 'http://example.com/enc.mpd', {
            licenseType: 'clearkey',
            supported: true,
            clearKeys: { abc: 'def' },
        });
        await flush();

        environment.instances[0].dispatch('error', {
            severity: 2,
            category: 6,
            code: 6001,
        });

        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(PlaybackDiagnosticCode.DrmOrEncryption);
        // MPV/VLC never receive the KODIPROP license config, so they are not
        // offered as a fallback for key failures on ClearKey channels.
        expect(issues[0].externalFallbackRecommended).toBe(false);

        // Non-DRM failures (media/codec/manifest/…) are equally unsolvable
        // externally while the stream itself stays encrypted.
        session.start(video, 'http://example.com/enc.mpd', {
            licenseType: 'clearkey',
            supported: true,
            clearKeys: { abc: 'def' },
        });
        await flush();
        environment.instances[1].dispatch('error', {
            severity: 2,
            category: 3,
            code: 3016,
        });

        expect(issues).toHaveLength(2);
        expect(issues[1].code).toBe(PlaybackDiagnosticCode.MediaDecodeError);
        expect(issues[1].externalFallbackRecommended).toBe(false);
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
            PlaybackDiagnosticCode.UnknownPlaybackError
        );
        expect(issues[0].sourceUrl).toBe('http://example.com/bad.mpd');
        expect(issues[0].shaka).toEqual({
            severity: 'critical',
            category: 'manifest',
            engineCode: 4001,
            disposition: 'terminal',
            stage: 'manifest',
            failure: 'manifest',
        });
        // The failed engine must not stay attached or exposed to controls.
        expect(environment.instances[0].destroyCount).toBe(1);
        expect(session.getPlayer()).toBeNull();
    });

    it('treats a recoverable-severity load rejection as terminal lifecycle evidence', async () => {
        const secret = 'load-http-secret';
        const environment = createFakeShakaEnvironment({
            onCreate: (player) => {
                player.loadResult = Promise.reject({
                    severity: 1,
                    category: 1,
                    code: 1001,
                    message: `https://provider.example/?token=${secret}`,
                    data: [
                        `https://provider.example/manifest.mpd?token=${secret}`,
                        503,
                        `provider body ${secret}`,
                        { Authorization: `Bearer ${secret}` },
                    ],
                });
            },
        });
        const session = createSession(environment);
        session.start(video, 'http://example.com/retry-exhausted.mpd');
        await flush();

        expect(issues).toHaveLength(1);
        expect(issues[0]).toEqual(
            expect.objectContaining({
                code: PlaybackDiagnosticCode.NetworkError,
                httpStatus: 503,
                shaka: {
                    severity: 'recoverable',
                    category: 'network',
                    engineCode: 1001,
                    disposition: 'terminal',
                    stage: 'unknown',
                    failure: 'network',
                    httpStatus: 503,
                },
            })
        );
        const serialized = JSON.stringify(issues[0].shaka);
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain('provider.example');
        expect(serialized).not.toContain('Authorization');
        expect(environment.instances[0].destroyCount).toBe(1);
        expect(session.getPlayer()).toBeNull();
    });

    it('preserves the exact streaming startup error through the session boundary', async () => {
        const environment = createFakeShakaEnvironment({
            onCreate: (player) => {
                player.loadResult = Promise.reject({
                    severity: 2,
                    category: 5,
                    code: 5006,
                });
            },
        });
        const session = createSession(environment);
        session.start(video, 'http://example.com/startup-failed.mpd');
        await flush();

        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(
            PlaybackDiagnosticCode.UnknownPlaybackError
        );
        expect(issues[0].shaka).toEqual({
            severity: 'critical',
            category: 'streaming',
            engineCode: 5006,
            disposition: 'terminal',
            stage: 'unknown',
            failure: 'unknown',
        });
    });

    it('preserves a terminal text-parser event without retaining parser data', async () => {
        const secret = 'subtitle-parser-secret';
        const environment = createFakeShakaEnvironment();
        const session = createSession(environment);
        session.start(video, 'http://example.com/text-track.mpd');
        await flush();

        const player = environment.instances[0];
        player.dispatch('error', {
            severity: 2,
            category: 2,
            code: 2000,
            message: `malformed WebVTT from ${secret}`,
            data: [{ cue: secret }],
        });

        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(
            PlaybackDiagnosticCode.UnknownPlaybackError
        );
        expect(issues[0].shaka).toEqual({
            severity: 'critical',
            category: 'text',
            engineCode: 2000,
            disposition: 'terminal',
            stage: 'unknown',
            failure: 'unknown',
        });
        expect(JSON.stringify(issues[0])).not.toContain(secret);
        expect(player.destroyCount).toBe(1);
        expect(session.getPlayer()).toBeNull();
    });

    it('emits a critical in-flight error once before teardown interrupts load', async () => {
        const environment = createFakeShakaEnvironment({
            onCreate: (player) => {
                player.stallNextLoad = true;
            },
        });
        const session = createSession(environment);
        session.start(video, 'http://example.com/stalled.mpd');
        await flush();

        const player = environment.instances[0];
        player.dispatch('error', {
            severity: 2,
            category: 6,
            code: 6008,
        });
        await flush();

        expect(issues).toHaveLength(1);
        expect(issues[0].shaka).toEqual(
            expect.objectContaining({
                engineCode: 6008,
                disposition: 'terminal',
            })
        );
        expect(player.destroyCount).toBe(1);
        expect(session.getPlayer()).toBeNull();
    });

    it('does not suppress an arbitrary load rejection that only reuses code 7000', async () => {
        const environment = createFakeShakaEnvironment({
            onCreate: (player) => {
                player.loadResult = Promise.reject({
                    severity: 2,
                    category: 1,
                    code: 7000,
                });
            },
        });
        const session = createSession(environment);
        session.start(video, 'http://example.com/not-interrupted.mpd');
        await flush();

        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(
            PlaybackDiagnosticCode.UnknownPlaybackError
        );
        expect(issues[0].shaka).toEqual({
            severity: 'critical',
            category: 'network',
            engineCode: 7000,
            disposition: 'terminal',
            stage: 'unknown',
            failure: 'unknown',
        });
    });

    it('drops arbitrary module-loader rejection messages', async () => {
        const secret = 'module-loader-secret';
        const session = new ShakaVideoSession({
            player: InlinePlaybackPlayer.Html5,
            emitPlaybackIssue: (issue) => issues.push(issue),
            loadShaka: () =>
                Promise.reject(
                    new Error(
                        `https://user:${secret}@provider.example/shaka.js`
                    )
                ),
        });

        session.start(video, 'http://example.com/a.mpd');
        await flush();

        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(
            PlaybackDiagnosticCode.UnknownPlaybackError
        );
        expect(issues[0].details).toBeUndefined();
        expect(issues[0].shaka).toEqual({
            severity: 'unknown',
            category: 'unknown',
            engineCode: 'unknown',
            disposition: 'terminal',
            stage: 'unknown',
            failure: 'unknown',
        });
        expect(JSON.stringify(issues[0])).not.toContain(secret);
        expect(JSON.stringify(issues[0])).not.toContain('provider.example');
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
        // The slow player resolved after being superseded; nothing may have
        // touched its text tracks afterwards.
        expect(slow.selectTextTrackCalls).toEqual([]);
        expect(issues).toEqual([]);
    });

    it('suppresses auto-selected captions on load and restores them on demand', async () => {
        const environment = createFakeShakaEnvironment({
            onCreate: (player) => {
                player.textTracks = [
                    {
                        id: 7,
                        active: true,
                        language: 'en',
                        label: 'English',
                        kind: 'subtitles',
                    },
                ];
            },
        });
        const session = createSession(environment);
        session.start(video, 'http://example.com/subs.mpd');
        await flush();

        const player = environment.instances[0];
        // showCaptions() is false: the auto-selected track is hidden…
        expect(player.selectTextTrackCalls).toEqual([null]);
        expect(player.textTracks[0].active).toBe(false);

        // …and remembered, so re-enabling the preference restores it.
        session.restoreSuppressedTextTrack();
        expect(player.textTracks[0].active).toBe(true);

        // The restore is one-shot.
        session.restoreSuppressedTextTrack();
        expect(player.selectTextTrackCalls).toHaveLength(2);
    });

    it('keeps external fallback available when the browser cannot run Shaka for clear DASH', async () => {
        const environment = createFakeShakaEnvironment();
        environment.browserSupported = false;
        const session = createSession(environment);
        session.start(video, 'http://example.com/a.mpd');
        await flush();

        expect(environment.instances).toHaveLength(0);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(
            PlaybackDiagnosticCode.UnknownPlaybackError
        );
        expect(issues[0].shaka).toEqual({
            severity: 'unknown',
            category: 'unknown',
            engineCode: 'unknown',
            disposition: 'terminal',
            stage: 'unknown',
            failure: 'unknown',
        });
        expect(issues[0].externalFallbackRecommended).toBe(true);
    });

    it('keeps external fallback unavailable when browser support fails for KODIPROP DRM', async () => {
        const environment = createFakeShakaEnvironment();
        environment.browserSupported = false;
        const session = createSession(environment);
        session.start(video, 'http://example.com/encrypted.mpd', {
            licenseType: 'clearkey',
            supported: true,
            clearKeys: { abc: 'def' },
        });
        await flush();

        expect(environment.instances).toHaveLength(0);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(
            PlaybackDiagnosticCode.UnknownPlaybackError
        );
        expect(issues[0].externalFallbackRecommended).toBe(false);
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

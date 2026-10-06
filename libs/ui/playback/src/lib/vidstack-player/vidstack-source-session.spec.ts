import type { ChannelDrm } from '@iptvnator/shared/interfaces';
import {
    InlinePlaybackPlayer,
    type PlaybackDiagnostic,
    PlaybackDiagnosticSource,
} from '@iptvnator/playback/util';
import {
    createFakeShakaEnvironment,
    flushShakaMicrotasks,
} from '../shaka-engine/shaka-player-test-double';
import {
    MockHls,
    MockMpegTsPlayer,
    asProvider,
    createFakeHlsProvider,
    createFakeVideoProvider,
    createMpegTsPlayer,
    createSession,
    initVidstackSourceSessionModule,
    isMpegTsSupported,
    mpegTsInstances,
    resetVidstackSourceFixtures,
} from './vidstack-source-session.spec-fixtures';

const HLS_URL = 'https://example.test/live.m3u8';
const TS_URL = 'https://example.test/live/1.ts';
const MP4_URL = 'https://example.test/movie.mp4';
const DASH_URL = 'https://example.test/live.mpd';

describe('VidstackSourceSession', () => {
    beforeAll(async () => {
        await initVidstackSourceSessionModule();
    });

    beforeEach(() => {
        resetVidstackSourceFixtures();
    });

    describe('HLS on the Vidstack HLS provider', () => {
        it('feeds the bundled hls.js instead of the jsDelivr default', () => {
            const { session } = createSession({
                url: HLS_URL,
                sharedControls: false,
            });
            const provider = createFakeHlsProvider();

            const video = session.attachProvider(asProvider(provider));

            expect(video).toBe(provider.video);
            expect(provider.library).toBe(MockHls);
            // Preference off, Vidstack keeps rendering hls.js subtitles.
            expect(provider.config).toEqual({});
        });

        it('renders hls.js subtitles natively for the shared controls', () => {
            const { session, adapter } = createSession({
                url: HLS_URL,
                sharedControls: true,
            });
            const attach = jest.spyOn(adapter, 'attach');
            const provider = createFakeHlsProvider();

            session.attachProvider(asProvider(provider));
            provider.createInstance();

            expect(provider.config).toEqual({
                renderTextTracksNatively: true,
            });
            expect(attach).toHaveBeenCalledWith(
                provider.video,
                expect.objectContaining({
                    getAudioTracks: expect.any(Function),
                    getSubtitleTracks: expect.any(Function),
                })
            );
        });

        it('reports fatal hls.js errors as Vidstack diagnostics', () => {
            const issues: PlaybackDiagnostic[] = [];
            const { session } = createSession({
                url: HLS_URL,
                sharedControls: false,
                emitPlaybackIssue: (issue) => issues.push(issue),
            });
            const provider = createFakeHlsProvider();
            session.attachProvider(asProvider(provider));
            const hls = provider.createInstance();

            hls.emit(MockHls.Events.ERROR, 'hlsError', {
                type: 'networkError',
                details: 'manifestLoadError',
                fatal: true,
                response: { code: 404 },
            });

            expect(issues).toHaveLength(1);
            expect(issues[0]).toEqual(
                expect.objectContaining({
                    player: InlinePlaybackPlayer.Vidstack,
                    source: PlaybackDiagnosticSource.Hls,
                })
            );
        });

        it('only removes its own listeners: Vidstack owns the hls.js instance', () => {
            const { session } = createSession({
                url: HLS_URL,
                sharedControls: false,
            });
            const provider = createFakeHlsProvider();
            session.attachProvider(asProvider(provider));
            const hls = provider.createInstance();
            expect(hls.listenerCount(MockHls.Events.ERROR)).toBe(1);
            expect(hls.listenerCount(MockHls.Events.MANIFEST_PARSED)).toBe(1);

            session.destroy();

            expect(hls.listenerCount(MockHls.Events.ERROR)).toBe(0);
            expect(hls.listenerCount(MockHls.Events.MANIFEST_PARSED)).toBe(0);
            expect(hls.destroy).not.toHaveBeenCalled();
            // A late instance from the destroyed player is ignored.
            const late = provider.createInstance();
            expect(late.listenerCount(MockHls.Events.ERROR)).toBe(0);
        });

        it('leaves natively played HLS to the Vidstack video provider', async () => {
            const { session } = createSession({
                url: HLS_URL,
                sharedControls: false,
            });
            const provider = createFakeVideoProvider();

            session.attachProvider(asProvider(provider));
            await provider.loadSource({ src: HLS_URL, type: 'x' });

            expect(provider.vendorLoadSource).toHaveBeenCalledTimes(1);
        });
    });

    describe('app engines on the Vidstack video provider', () => {
        it('plays raw MPEG-TS through mpegts.js on the provider video', async () => {
            const { session } = createSession({
                url: TS_URL,
                sharedControls: true,
                isLive: false,
            });
            const provider = createFakeVideoProvider();
            session.attachProvider(asProvider(provider));
            const src = { src: TS_URL, type: 'video/mp4' };

            await provider.loadSource(src, 'metadata');

            expect(provider.vendorLoadSource).not.toHaveBeenCalled();
            expect(createMpegTsPlayer).toHaveBeenCalledWith({
                type: 'mpegts',
                isLive: false,
                url: TS_URL,
            });
            const engine = mpegTsInstances[0];
            expect(engine.attachMediaElement).toHaveBeenCalledWith(
                provider.video
            );
            expect(engine.load).toHaveBeenCalledTimes(1);
            expect(provider.currentSrc).toBe(src);
            expect(provider.video.preload).toBe('metadata');
        });

        it('classifies mpegts.js errors and tears the engine down on destroy', async () => {
            const issues: PlaybackDiagnostic[] = [];
            const { session } = createSession({
                url: TS_URL,
                sharedControls: false,
                emitPlaybackIssue: (issue) => issues.push(issue),
            });
            const provider = createFakeVideoProvider();
            session.attachProvider(asProvider(provider));
            await provider.loadSource({ src: TS_URL, type: 'video/mp4' });
            const engine = mpegTsInstances[0] as MockMpegTsPlayer;

            engine.handlers.get('error')?.('MediaError', 'CodecUnsupported', {
                message: 'unsupported',
            });
            session.destroy();

            expect(issues).toHaveLength(1);
            expect(issues[0]).toEqual(
                expect.objectContaining({
                    code: 'unsupported-codec',
                    player: InlinePlaybackPlayer.Vidstack,
                    source: PlaybackDiagnosticSource.MpegTs,
                    sourceUrl: TS_URL,
                })
            );
            expect(engine.off).toHaveBeenCalledWith(
                'error',
                expect.any(Function)
            );
            expect(engine.unload).toHaveBeenCalledTimes(1);
            expect(engine.detachMediaElement).toHaveBeenCalledTimes(1);
            expect(engine.destroy).toHaveBeenCalledTimes(1);
        });

        it('lets the browser try raw MPEG-TS when MediaSource is missing', async () => {
            isMpegTsSupported.mockReturnValue(false);
            const { session } = createSession({
                url: TS_URL,
                sharedControls: false,
            });
            const provider = createFakeVideoProvider();
            session.attachProvider(asProvider(provider));

            await provider.loadSource({ src: TS_URL, type: 'video/mp4' });

            expect(createMpegTsPlayer).not.toHaveBeenCalled();
            expect(provider.video.getAttribute('src')).toBe(TS_URL);
        });

        it('assigns other containers straight to the video', async () => {
            const { session } = createSession({
                url: MP4_URL,
                sharedControls: false,
            });
            const provider = createFakeVideoProvider();
            session.attachProvider(asProvider(provider));

            await provider.loadSource({ src: MP4_URL, type: 'video/mp4' });

            expect(provider.vendorLoadSource).not.toHaveBeenCalled();
            expect(provider.video.getAttribute('src')).toBe(MP4_URL);
        });

        it('starts Shaka with the channel DRM for DASH', async () => {
            const fakeShaka = createFakeShakaEnvironment();
            const drm: ChannelDrm = {
                licenseType: 'clearkey',
                supported: true,
                clearKeys: { abc: 'def' },
            };
            const { session } = createSession({
                url: DASH_URL,
                sharedControls: true,
                getDrm: () => drm,
                loadShaka: fakeShaka.loader,
            });
            const provider = createFakeVideoProvider();
            session.attachProvider(asProvider(provider));

            await provider.loadSource({ src: DASH_URL, type: 'video/mp4' });
            await flushShakaMicrotasks();

            expect(fakeShaka.instances).toHaveLength(1);
            expect(fakeShaka.instances[0].attachedTo).toBe(provider.video);
            expect(fakeShaka.instances[0].loadedUrls).toEqual([DASH_URL]);
            expect(fakeShaka.instances[0].configureCalls).toEqual([
                { drm: { clearKeys: { abc: 'def' } } },
            ]);
            expect(mpegTsInstances).toHaveLength(0);
            session.destroy();
        });

        it('ignores loads and providers once destroyed', async () => {
            const { session } = createSession({
                url: TS_URL,
                sharedControls: false,
            });
            const provider = createFakeVideoProvider();
            session.attachProvider(asProvider(provider));
            session.destroy();

            await provider.loadSource({ src: TS_URL, type: 'video/mp4' });

            expect(createMpegTsPlayer).not.toHaveBeenCalled();
            expect(
                session.attachProvider(asProvider(createFakeVideoProvider()))
            ).toBeNull();
        });
    });

    it('ignores providers without a video element', () => {
        const { session } = createSession({
            url: MP4_URL,
            sharedControls: false,
        });

        expect(session.attachProvider(null)).toBeNull();
        expect(
            session.attachProvider(
                asProvider({
                    ...createFakeVideoProvider(),
                    type: 'youtube',
                } as never)
            )
        ).toBeNull();
    });
});

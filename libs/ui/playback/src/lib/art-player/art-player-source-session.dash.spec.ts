import type { ChannelDrm } from '@iptvnator/shared/interfaces';
import {
    InlinePlaybackPlayer,
    type PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '../playback-diagnostics/playback-diagnostics.model';
import {
    createFakeShakaEnvironment,
    flushShakaMicrotasks,
} from '../shaka-engine/shaka-player-test-double';
import {
    createSession,
    hlsInstances,
    initArtPlayerSourceSessionModule,
    mpegTsInstances,
    resetArtPlayerSourceFixtures,
} from './art-player-source-session.spec-fixtures';

describe('ArtPlayerSourceSession DASH (mpd custom type)', () => {
    beforeAll(async () => {
        await initArtPlayerSourceSessionModule();
    });

    beforeEach(() => {
        resetArtPlayerSourceFixtures();
    });

    it('starts the Shaka engine with channel DRM for the mpd custom type', async () => {
        const fakeShaka = createFakeShakaEnvironment();
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
        await flushShakaMicrotasks();

        expect(fakeShaka.loaderCalls).toBe(1);
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
        const fakeShaka = createFakeShakaEnvironment();
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
        await flushShakaMicrotasks();
        session.customType['m3u8']?.(
            video,
            'https://example.test/live.m3u8',
            player
        );
        await flushShakaMicrotasks();

        expect(fakeShaka.instances[0].destroyCount).toBe(1);
        expect(hlsInstances).toHaveLength(1);

        session.destroy();
        await flushShakaMicrotasks();
        expect(fakeShaka.instances).toHaveLength(1);
    });

    it('routes only sanitized terminal Shaka evidence through the ArtPlayer adapter', async () => {
        const secret = 'artplayer-shaka-secret';
        const issues: PlaybackDiagnostic[] = [];
        const fakeShaka = createFakeShakaEnvironment({
            onCreate: (shakaPlayer) => {
                shakaPlayer.loadResult = Promise.reject({
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
        const { session, player, video } = createSession({
            sharedControls: true,
            emitPlaybackIssue: (issue) => issues.push(issue),
            loadShaka: fakeShaka.loader,
        });
        session.attach(player);

        session.customType['mpd']?.(
            video,
            'https://example.test/failing.mpd',
            player
        );
        await flushShakaMicrotasks();

        expect(issues).toHaveLength(1);
        expect(issues[0]).toEqual(
            expect.objectContaining({
                source: PlaybackDiagnosticSource.Shaka,
                player: InlinePlaybackPlayer.ArtPlayer,
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
        expect(JSON.stringify(issues[0].shaka)).not.toContain(secret);
        expect(JSON.stringify(issues[0].shaka)).not.toContain(
            'provider.example'
        );
        expect(JSON.stringify(issues[0].shaka)).not.toContain('Authorization');
    });
});

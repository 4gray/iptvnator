import type { PlaybackDiagnostic } from '../playback-diagnostics/playback-diagnostics.util';
import {
    MockHls,
    MockMpegTsPlayer,
    createMpegTsPlayer,
    createSession,
    createTimeRanges,
    hlsInstances,
    initArtPlayerSourceSessionModule,
    mpegTsInstances,
    resetArtPlayerSourceFixtures,
} from './art-player-source-session.spec-fixtures';

describe('ArtPlayerSourceSession', () => {
    beforeAll(async () => {
        await initArtPlayerSourceSessionModule();
    });

    beforeEach(() => {
        resetArtPlayerSourceFixtures();
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
});

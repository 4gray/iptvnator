import { Component, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    type PlaybackDiagnostic,
} from '@iptvnator/playback/util';
import {
    VideoPlayer,
    type ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { ErrorDetails } from 'hls.js';
import { WebPlayerLiveAutoFormat } from './web-player-live-auto-format';

@Component({ template: '' })
class Host {}

const failure: PlaybackDiagnostic = {
    code: PlaybackDiagnosticCode.NetworkError,
    source: PlaybackDiagnosticSource.Vhs,
    sourceUrl: '',
    container: 'm3u8',
    player: 'videojs',
    httpStatus: 403,
    audioCodecs: [],
    videoCodecs: [],
};
const source: ResolvedPortalPlayback = {
    streamUrl: 'https://fixture.test/stream.php?token=synthetic&extension=m3u8',
    liveAutoTsUrl:
        'https://fixture.test/other.php?token=synthetic&extension=ts',
    title: 'Fixture',
    isLive: true,
    userAgent: 'fixture',
    headers: { Authorization: 'Bearer synthetic' },
};

describe('Auto live source-format attempt lifecycle', () => {
    const playback = signal<ResolvedPortalPlayback | null>(source);
    const sessionKey = signal('playlist-a/channel-1');
    const player = signal(VideoPlayer.VideoJs);
    const intent = signal(0);
    const autoEnabled = signal(true);
    let controller: WebPlayerLiveAutoFormat;
    let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
    beforeEach(() => {
        playback.set({ ...source });
        sessionKey.set('playlist-a/channel-1');
        player.set(VideoPlayer.VideoJs);
        intent.set(0);
        autoEnabled.set(true);
        fixture = TestBed.createComponent(Host);
        controller = new WebPlayerLiveAutoFormat({
            playback,
            sessionKey,
            player,
            intent,
            autoEnabled,
            injector: fixture.debugElement.injector.get(Injector),
        });
        fixture.detectChanges();
    });
    afterEach(() => {
        controller.destroy();
        fixture.destroy();
    });
    async function render() {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    it('waits for the old transport render, preserves the whole payload and consumes only one attempt', async () => {
        expect(controller.tryFallback(failure)).toBe(true);
        expect(controller.pending()).toBe(true);
        expect(controller.playback()).toBe(playback());
        expect(controller.tryFallback(failure)).toBe(false);
        await render();
        expect(controller.playback()).toEqual({
            ...source,
            streamUrl: source.liveAutoTsUrl,
            liveAutoTsUrl: undefined,
        });
        const mounted = controller.playback();
        controller.started();
        expect(controller.playback()).toBe(mounted);
        expect(controller.tryFallback(failure)).toBe(false);
        intent.update((n) => n + 1);
        expect(controller.playback()?.streamUrl).toBe(source.liveAutoTsUrl);
        player.set(VideoPlayer.Html5Player);
        expect(controller.playback()?.streamUrl).toBe(source.liveAutoTsUrl);
    });
    it('does not downgrade after actual playing', () => {
        controller.started();
        expect(controller.tryFallback(failure)).toBe(false);
    });
    it.each([0, 200, undefined])(
        'does not guess from HTTP status %s',
        (httpStatus) => {
            expect(controller.tryFallback({ ...failure, httpStatus })).toBe(
                false
            );
        }
    );
    it.each([
        PlaybackDiagnosticCode.UnknownPlaybackError,
        PlaybackDiagnosticCode.DrmOrEncryption,
        PlaybackDiagnosticCode.MediaDecodeError,
    ])('does not downgrade %s', (code) => {
        expect(controller.tryFallback({ ...failure, code })).toBe(false);
    });
    it.each(['key', 'media', 'unknown'] as const)(
        'does not downgrade HLS %s failures even with an HTTP status',
        (stage) => {
            expect(
                controller.tryFallback({
                    ...failure,
                    hls: {
                        engineType: 'unknown',
                        engineDetails: ErrorDetails.KEY_LOAD_ERROR,
                        disposition: 'fatal',
                        stage,
                        failure: 'http',
                        httpStatus: 403,
                    },
                })
            ).toBe(false);
        }
    );
    it('respects manual preference changes before the failure and before pending completion', async () => {
        autoEnabled.set(false);
        expect(controller.tryFallback(failure)).toBe(false);
        autoEnabled.set(true);
        expect(controller.tryFallback(failure)).toBe(true);
        autoEnabled.set(false);
        await render();
        expect(controller.playback()).toBe(playback());
    });
    it('ignores a delayed completion after another playlist or channel takes ownership', async () => {
        controller.tryFallback(failure);
        sessionKey.set('playlist-b/channel-1');
        playback.set({ ...source, title: 'Other playlist' });
        await render();
        expect(controller.playback()).toBe(playback());
        expect(controller.tryFallback(failure)).toBe(true);
        await render();
        expect(controller.playback()?.streamUrl).toBe(source.liveAutoTsUrl);
    });
    it('cancels on disposal and does not transfer attempts to another mounted session', async () => {
        controller.tryFallback(failure);
        controller.destroy();
        await render();
        expect(controller.playback()).toBe(playback());
        expect(controller.tryFallback(failure)).toBe(false);
    });
    it('does not rearm when same-session source metadata refreshes', async () => {
        controller.tryFallback(failure);
        await render();
        playback.set({ ...source, title: 'Refreshed' });
        expect(controller.playback()?.streamUrl).toBe(source.liveAutoTsUrl);
        expect(controller.playback()?.title).toBe('Refreshed');
        playback.set({ ...source, streamUrl: 'https://other.test/live.m3u8' });
        expect(controller.playback()?.streamUrl).toBe(
            'https://other.test/live.m3u8'
        );
        expect(controller.tryFallback(failure)).toBe(false);
    });
    it.each([
        { isLive: false },
        { liveAutoTsUrl: undefined },
        { drm: {} },
        { contentInfo: {} },
    ])(
        'excludes VOD, catchup, missing advertisement and DRM: %j',
        (overrides) => {
            playback.set({ ...source, ...overrides } as ResolvedPortalPlayback);
            expect(controller.tryFallback(failure)).toBe(false);
        }
    );
    it('does not start an Embedded MPV attempt', () => {
        player.set(VideoPlayer.EmbeddedMpv);
        expect(controller.tryFallback(failure)).toBe(false);
    });
});

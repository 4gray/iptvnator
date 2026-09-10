import type Hls from 'hls.js';
import type {
    ShakaPlayerLike,
    ShakaVariantTrackLike,
} from '../shaka-engine/shaka-module.types';
import type { ShakaVideoSession } from '../shaka-engine/shaka-video-session';
import { WebVideoSourceStats } from './web-video-source-stats';

function createHls(overrides: Partial<Hls> = {}): Hls {
    return {
        currentLevel: 0,
        loadLevel: 0,
        audioTrack: 0,
        audioTracks: [
            {
                audioCodec: 'mp4a.40.2',
                bitrate: 128_000,
                channels: '6',
            },
        ],
        levels: [
            {
                bitrate: 5_000_000,
                realBitrate: 4_800_000,
                width: 1920,
                height: 1080,
                videoCodec: 'avc1.640028',
                audioCodec: 'mp4a.40.2',
                frameRate: 25,
            },
        ],
        ...overrides,
    } as unknown as Hls;
}

function createShakaSession(player: ShakaPlayerLike | null): ShakaVideoSession {
    return { getPlayer: () => player } as unknown as ShakaVideoSession;
}

function createVariant(
    overrides: Partial<ShakaVariantTrackLike> = {}
): ShakaVariantTrackLike {
    return {
        id: 1,
        active: true,
        language: 'en',
        label: null,
        width: 1280,
        height: 720,
        bandwidth: 3_000_000,
        videoBandwidth: 2_800_000,
        audioBandwidth: 128_000,
        videoCodec: 'avc1.4d401f',
        audioCodec: 'mp4a.40.2',
        frameRate: 30,
        channelsCount: 6,
        audioSamplingRate: 48_000,
        mimeType: 'video/mp4',
        ...overrides,
    };
}

describe('WebVideoSourceStats', () => {
    it('reports nothing before a source is bound', () => {
        expect(new WebVideoSourceStats().read()).toBeNull();
    });

    describe('HLS', () => {
        it('describes the active level', () => {
            const stats = new WebVideoSourceStats();
            stats.setSource({ kind: 'hls', hls: createHls() });

            expect(stats.read()).toEqual({
                // HLS declares aggregate bandwidth; fragments may omit alternate audio.
                streamBitrateBps: 5_000_000,
                videoBitrateBps: null,
                // Audio details come from the selected audio rendition.
                audioBitrateBps: 128_000,
                videoCodec: 'avc1.640028',
                audioCodec: 'mp4a.40.2',
                audioChannels: '6',
                container: 'HLS',
                nominalFps: 25,
                width: 1920,
                height: 1080,
            });
        });

        it('falls back to the declared bitrate before fragments land', () => {
            const stats = new WebVideoSourceStats();
            stats.setSource({
                kind: 'hls',
                hls: createHls({
                    levels: [
                        {
                            bitrate: 5_000_000,
                            realBitrate: 0,
                            width: 1920,
                            height: 1080,
                            frameRate: 25,
                        },
                    ] as unknown as Hls['levels'],
                }),
            });

            expect(stats.read()).toMatchObject({
                videoBitrateBps: null,
                streamBitrateBps: 5_000_000,
            });
        });

        it('keeps the video level codec when no audio rendition exists', () => {
            const stats = new WebVideoSourceStats();
            stats.setSource({
                kind: 'hls',
                hls: createHls({
                    audioTracks: [] as unknown as Hls['audioTracks'],
                }),
            });

            expect(stats.read()).toEqual(
                expect.objectContaining({
                    audioCodec: 'mp4a.40.2',
                    audioBitrateBps: null,
                    audioChannels: null,
                })
            );
        });

        it('uses the load level while ABR has not settled', () => {
            const stats = new WebVideoSourceStats();
            stats.setSource({
                kind: 'hls',
                hls: createHls({ currentLevel: -1, loadLevel: 0 }),
            });

            expect(stats.read()?.width).toBe(1920);
        });

        it('still names the container when no level is known yet', () => {
            const stats = new WebVideoSourceStats();
            stats.setSource({
                kind: 'hls',
                hls: createHls({ currentLevel: -1, loadLevel: -1 }),
            });

            expect(stats.read()).toEqual({ container: 'HLS' });
        });
    });

    describe('Shaka', () => {
        it('describes the active variant', () => {
            const player = {
                getVariantTracks: () => [
                    createVariant({ active: false, id: 0 }),
                    createVariant(),
                ],
                getStats: () => ({ streamBandwidth: 2_900_000 }),
            } as unknown as ShakaPlayerLike;
            const stats = new WebVideoSourceStats();
            stats.setSource({
                kind: 'shaka',
                session: createShakaSession(player),
            });

            expect(stats.read()).toEqual({
                videoBitrateBps: 2_800_000,
                streamBitrateBps: 3_000_000,
                audioBitrateBps: 128_000,
                videoCodec: 'avc1.4d401f',
                audioCodec: 'mp4a.40.2',
                audioChannels: 6,
                audioSampleRateHz: 48_000,
                container: 'video/mp4',
                nominalFps: 30,
                width: 1280,
                height: 720,
            });
        });

        it('keeps total bandwidth out of the video bitrate when its separate rate is unknown', () => {
            const player = {
                getVariantTracks: () => [
                    createVariant({ videoBandwidth: null }),
                ],
                getStats: () => ({ streamBandwidth: 2_900_000 }),
            } as unknown as ShakaPlayerLike;
            const stats = new WebVideoSourceStats();
            stats.setSource({
                kind: 'shaka',
                session: createShakaSession(player),
            });

            expect(stats.read()).toMatchObject({
                videoBitrateBps: null,
                streamBitrateBps: 3_000_000,
                audioBitrateBps: 128_000,
            });
        });

        it('works with a player build that exposes no getStats', () => {
            const player = {
                getVariantTracks: () => [createVariant()],
            } as unknown as ShakaPlayerLike;
            const stats = new WebVideoSourceStats();
            stats.setSource({
                kind: 'shaka',
                session: createShakaSession(player),
            });

            expect(stats.read()?.videoBitrateBps).toBe(2_800_000);
        });

        it('reports nothing without a player', () => {
            const stats = new WebVideoSourceStats();
            stats.setSource({
                kind: 'shaka',
                session: createShakaSession(null),
            });

            expect(stats.read()).toBeNull();
        });
    });

    it('names the container of a raw MPEG-TS source', () => {
        const stats = new WebVideoSourceStats();
        stats.setSource({ kind: 'mpegts' });

        expect(stats.read()).toEqual({ container: 'MPEG-TS' });
    });

    it('leaves a native source to the element alone', () => {
        const stats = new WebVideoSourceStats();
        stats.setSource({ kind: 'native' });

        expect(stats.read()).toBeNull();
    });

    it('forgets the engine when the source is cleared', () => {
        const stats = new WebVideoSourceStats();
        stats.setSource({ kind: 'hls', hls: createHls() });
        stats.setSource(null);

        expect(stats.read()).toBeNull();
    });
});

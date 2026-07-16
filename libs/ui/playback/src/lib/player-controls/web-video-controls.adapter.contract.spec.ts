import type { PlayerTrack } from './player-controls.model';
import { WebVideoControlsAdapter } from './web-video-controls.adapter';

interface VideoOverrides {
    duration: number;
    readyState: number;
    networkState: number;
    paused: boolean;
    ended: boolean;
    error: MediaError | null;
    seekableLength: number;
}

function createVideo(
    overrides: Partial<VideoOverrides> = {}
): HTMLVideoElement {
    const video = document.createElement('video');
    const define = (prop: string, value: unknown) =>
        Object.defineProperty(video, prop, {
            configurable: true,
            writable: true,
            value,
        });

    define('duration', overrides.duration ?? NaN);
    define('readyState', overrides.readyState ?? 4);
    define('networkState', overrides.networkState ?? 1);
    define('paused', overrides.paused ?? false);
    define('ended', overrides.ended ?? false);
    define('error', overrides.error ?? null);
    define('seekable', { length: overrides.seekableLength ?? 0 });
    return video;
}

describe('WebVideoControlsAdapter contract', () => {
    let adapter: WebVideoControlsAdapter;

    beforeEach(() => {
        adapter = new WebVideoControlsAdapter();
    });

    afterEach(() => adapter.detach());

    it('requires both selectable audio tracks and an audio setter', () => {
        const single: PlayerTrack[] = [
            { id: 0, label: 'English', selected: true },
        ];
        const multiple: PlayerTrack[] = [
            { id: 0, label: 'English', selected: true },
            { id: 1, label: 'German', selected: false },
        ];

        adapter.attach(createVideo(), {
            getAudioTracks: () => multiple,
        });
        expect(adapter.capabilities().audioTracks).toBe(false);

        adapter.attach(createVideo(), {
            getAudioTracks: () => single,
            setAudioTrack: jest.fn(),
        });
        expect(adapter.capabilities().audioTracks).toBe(false);

        adapter.attach(createVideo(), {
            getAudioTracks: () => multiple,
            setAudioTrack: jest.fn(),
        });
        expect(adapter.capabilities().audioTracks).toBe(true);
    });

    it('requires both subtitle tracks and a subtitle setter', () => {
        const subtitles: PlayerTrack[] = [
            { id: 0, label: 'English', selected: true },
        ];

        adapter.attach(createVideo(), {
            getSubtitleTracks: () => subtitles,
        });
        expect(adapter.capabilities().subtitles).toBe(false);

        adapter.attach(createVideo(), {
            getSubtitleTracks: () => [],
            setSubtitleTrack: jest.fn(),
        });
        expect(adapter.capabilities().subtitles).toBe(false);

        adapter.attach(createVideo(), {
            getSubtitleTracks: () => subtitles,
            setSubtitleTrack: jest.fn(),
        });
        expect(adapter.capabilities().subtitles).toBe(true);
    });

    it.each([NaN, Number.NEGATIVE_INFINITY])(
        'does not classify an unknown duration (%s) as live',
        (duration) => {
            adapter.attach(createVideo({ duration }));

            expect(adapter.state().isLive).toBe(false);
            expect(adapter.state().durationSeconds).toBeNull();
            expect(adapter.capabilities().seek).toBe(true);
        }
    );

    it('treats getDuration positive Infinity as authoritative', () => {
        adapter.attach(
            createVideo({
                duration: 90,
                seekableLength: 1,
            }),
            { getDuration: () => Number.POSITIVE_INFINITY }
        );

        expect(adapter.state().isLive).toBe(true);
        expect(adapter.state().durationSeconds).toBeNull();
        expect(adapter.state().canSeek).toBe(false);
    });

    it('maps an attached element with an empty network to idle', () => {
        adapter.attach(
            createVideo({
                networkState: 0,
                readyState: 0,
                paused: true,
            })
        );

        expect(adapter.state().status).toBe('idle');
    });

    it('keeps a paused preload or warmup user-playable', () => {
        adapter.attach(
            createVideo({
                networkState: 1,
                readyState: 0,
                paused: true,
            })
        );

        expect(adapter.state().status).toBe('paused');
    });

    it('maps actively playing media with insufficient data to loading', () => {
        adapter.attach(
            createVideo({
                networkState: 2,
                readyState: 2,
                paused: false,
            })
        );

        expect(adapter.state().status).toBe('loading');
    });
});

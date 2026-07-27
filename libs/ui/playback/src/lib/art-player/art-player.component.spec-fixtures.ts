export const artPlayerInstances: MockArtplayer[] = [];
export const hlsInstances: MockHls[] = [];
export const mpegTsInstances: MockMpegTsPlayer[] = [];

export class MockArtplayer {
    static AUTO_PLAYBACK_TIMEOUT = 0;

    readonly video = document.createElement('video');
    readonly setting = { add: jest.fn() };
    readonly on = jest.fn();
    readonly off = jest.fn();
    readonly destroy = jest.fn();
    readonly currentTime = 0;
    readonly duration = 0;
    seek = 0;
    volume: number;

    constructor(readonly options: Record<string, unknown>) {
        this.volume = Number(options['volume'] ?? 1);
        const stored = JSON.parse(
            localStorage.getItem('artplayer_settings') ?? '{}'
        ) as { volume?: unknown };
        if (typeof stored.volume === 'number') {
            this.volume = stored.volume;
        }
        artPlayerInstances.push(this);
    }
}

export class MockHls {
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

    readonly handlers = new Map<string, (...args: unknown[]) => void>();
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
    readonly loadSource = jest.fn();
    readonly attachMedia = jest.fn();
    readonly destroy = jest.fn();
    readonly audioTracks: unknown[] = [];

    constructor() {
        hlsInstances.push(this);
    }
}

export class MockMpegTsPlayer {
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
    readonly play = jest.fn();
    readonly pause = jest.fn();
    readonly unload = jest.fn();
    readonly detachMediaElement = jest.fn();
    readonly destroy = jest.fn();

    constructor() {
        mpegTsInstances.push(this);
    }
}

export function resetArtPlayerSpecFixtures(): void {
    artPlayerInstances.length = 0;
    hlsInstances.length = 0;
    mpegTsInstances.length = 0;
}

export function getCustomType(
    type: 'm3u8' | 'ts' | 'mkv'
): (video: HTMLVideoElement, url: string) => void {
    const customType = (
        artPlayerInstances[0].options['customType'] as Record<
            string,
            (video: HTMLVideoElement, url: string, art: MockArtplayer) => void
        >
    )[type];
    return (video, url) => customType(video, url, artPlayerInstances[0]);
}

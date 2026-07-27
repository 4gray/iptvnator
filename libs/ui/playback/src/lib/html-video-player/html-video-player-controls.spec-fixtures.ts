import { jest } from '@jest/globals';
import Hls from 'hls.js';
import { WebVideoControlsAdapter } from '../player-controls/web-video-controls.adapter';
import { HtmlVideoPlayerControlsBridge } from './html-video-player-controls.bridge';

export interface VideoFixtureOptions {
    duration?: number;
    seekableEnds?: number[];
    bufferedEnds?: number[];
    seekableThrows?: boolean;
    bufferedThrows?: boolean;
}

interface FakeHlsTrack {
    id?: number;
    name?: string;
    lang?: string;
}

type FakeHlsListener = (...args: unknown[]) => void;

export class FakeHls {
    audioTracks: FakeHlsTrack[] = [];
    subtitleTracks: FakeHlsTrack[] = [];
    readonly assignments: string[] = [];
    subtitleTrackSwitchEvents = 0;
    private readonly listeners = new Map<string, Set<FakeHlsListener>>();
    private emitSubtitleTrackSwitchOnAssignment = false;
    private selectedAudioTrack = -1;
    private selectedSubtitleTrack = -1;
    private displaySubtitles = false;

    readonly on = jest.fn((event: string, listener: FakeHlsListener): void => {
        const eventListeners =
            this.listeners.get(event) ?? new Set<FakeHlsListener>();
        eventListeners.add(listener);
        this.listeners.set(event, eventListeners);
    });

    readonly off = jest.fn((event: string, listener: FakeHlsListener): void => {
        this.listeners.get(event)?.delete(listener);
    });

    get audioTrack(): number {
        return this.selectedAudioTrack;
    }

    set audioTrack(value: number) {
        this.assignments.push(`audioTrack:${value}`);
        this.selectedAudioTrack = value;
    }

    get subtitleTrack(): number {
        return this.selectedSubtitleTrack;
    }

    set subtitleTrack(value: number) {
        this.assignments.push(`subtitleTrack:${value}`);
        this.selectedSubtitleTrack = value;
        if (this.emitSubtitleTrackSwitchOnAssignment) {
            this.subtitleTrackSwitchEvents += 1;
            if (this.subtitleTrackSwitchEvents > 10) {
                throw new Error('recursive HLS subtitle track assignment');
            }
            this.emit(Hls.Events.SUBTITLE_TRACK_SWITCH);
        }
    }

    get subtitleDisplay(): boolean {
        return this.displaySubtitles;
    }

    set subtitleDisplay(value: boolean) {
        this.assignments.push(`subtitleDisplay:${value}`);
        this.displaySubtitles = value;
    }

    emit(event: string): void {
        for (const listener of this.listeners.get(event) ?? []) {
            listener(event, {});
        }
    }

    enableSynchronousSubtitleTrackSwitch(): void {
        this.subtitleTrackSwitchEvents = 0;
        this.emitSubtitleTrackSwitchOnAssignment = true;
    }

    asHls(): Hls {
        return this as unknown as Hls;
    }
}

export interface FakeTextTrackOptions {
    kind?: string;
    label?: string;
    language?: string;
    mode?: TextTrackMode;
}

export function createTextTrack(options: FakeTextTrackOptions = {}): TextTrack {
    return {
        kind: options.kind ?? 'subtitles',
        label: options.label ?? '',
        language: options.language ?? '',
        mode: options.mode ?? 'hidden',
    } as unknown as TextTrack;
}

export class FakeTextTrackList {
    private readonly listeners = new Map<
        string,
        Set<EventListenerOrEventListenerObject>
    >();
    private tracks: TextTrack[];
    private indexedLength = 0;

    readonly addEventListener = jest.fn(
        (event: string, listener: EventListenerOrEventListenerObject): void => {
            const eventListeners =
                this.listeners.get(event) ??
                new Set<EventListenerOrEventListenerObject>();
            eventListeners.add(listener);
            this.listeners.set(event, eventListeners);
        }
    );

    readonly removeEventListener = jest.fn(
        (event: string, listener: EventListenerOrEventListenerObject): void => {
            this.listeners.get(event)?.delete(listener);
        }
    );

    constructor(tracks: TextTrack[] = []) {
        this.tracks = [...tracks];
        this.syncIndexedTracks();
    }

    get length(): number {
        return this.tracks.length;
    }

    getTrackById(): TextTrack | null {
        return null;
    }

    add(track: TextTrack): void {
        this.tracks.push(track);
        this.syncIndexedTracks();
        this.emit('addtrack');
    }

    remove(track: TextTrack): void {
        const index = this.tracks.indexOf(track);
        if (index < 0) {
            return;
        }
        this.tracks.splice(index, 1);
        this.syncIndexedTracks();
        this.emit('removetrack');
    }

    replaceSilently(tracks: TextTrack[]): void {
        this.tracks = [...tracks];
        this.syncIndexedTracks();
    }

    emit(eventName: 'addtrack' | 'removetrack' | 'change'): void {
        const event = new Event(eventName);
        for (const listener of this.listeners.get(eventName) ?? []) {
            if (typeof listener === 'function') {
                listener.call(this, event);
            } else {
                listener.handleEvent(event);
            }
        }
    }

    asTextTrackList(): TextTrackList {
        return this as unknown as TextTrackList;
    }

    private syncIndexedTracks(): void {
        for (let index = 0; index < this.indexedLength; index += 1) {
            Reflect.deleteProperty(this, index);
        }
        this.tracks.forEach((track, index) => {
            Object.defineProperty(this, index, {
                configurable: true,
                enumerable: true,
                value: track,
            });
        });
        this.indexedLength = this.tracks.length;
    }
}

function createTimeRanges(ends: number[], throwsWhenRead: boolean): TimeRanges {
    return {
        length: ends.length,
        start: (index: number) => {
            if (throwsWhenRead) {
                throw new Error('range start unavailable');
            }
            return index === 0 ? 0 : (ends[index - 1] ?? 0);
        },
        end: (index: number) => {
            if (throwsWhenRead) {
                throw new Error('range end unavailable');
            }
            return ends[index] ?? NaN;
        },
    };
}

export function createVideo(
    options: VideoFixtureOptions = {}
): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperties(video, {
        duration: {
            configurable: true,
            value: options.duration ?? NaN,
        },
        seekable: {
            configurable: true,
            value: createTimeRanges(
                options.seekableEnds ?? [],
                options.seekableThrows ?? false
            ),
        },
        buffered: {
            configurable: true,
            value: createTimeRanges(
                options.bufferedEnds ?? [],
                options.bufferedThrows ?? false
            ),
        },
        readyState: {
            configurable: true,
            value: 4,
        },
        networkState: {
            configurable: true,
            value: 1,
        },
        paused: {
            configurable: true,
            value: false,
        },
    });
    return video;
}

export function readMpegtsState(options: VideoFixtureOptions, isLive = false) {
    const adapter = new WebVideoControlsAdapter();
    const bridge = new HtmlVideoPlayerControlsBridge({
        video: createVideo(options),
        adapter,
        isLive: () => isLive,
        showCaptions: () => true,
    });

    bridge.attach();
    bridge.setSource({ kind: 'mpegts' });
    const state = adapter.state();
    bridge.destroy();
    return state;
}

export function bindHls(fakeHls: FakeHls, showCaptions = true) {
    const adapter = new WebVideoControlsAdapter();
    const captionPreference = { value: showCaptions };
    const bridge = new HtmlVideoPlayerControlsBridge({
        video: createVideo({ duration: 90, seekableEnds: [80] }),
        adapter,
        isLive: () => false,
        showCaptions: () => captionPreference.value,
    });
    bridge.attach();
    bridge.setSource({ kind: 'hls', hls: fakeHls.asHls() });
    return { adapter, bridge, captionPreference };
}

export function bindNativeTracks(
    tracks: TextTrack[],
    showCaptions = true,
    kind: 'native' | 'mpegts' = 'native'
) {
    const textTracks = new FakeTextTrackList(tracks);
    const video = createVideo({ duration: 90, seekableEnds: [80] });
    Object.defineProperty(video, 'textTracks', {
        configurable: true,
        value: textTracks.asTextTrackList(),
    });
    const captionPreference = { value: showCaptions };
    const adapter = new WebVideoControlsAdapter();
    const bridge = new HtmlVideoPlayerControlsBridge({
        video,
        adapter,
        isLive: () => false,
        showCaptions: () => captionPreference.value,
    });
    bridge.attach();
    bridge.setSource({ kind });
    return {
        adapter,
        bridge,
        captionPreference,
        textTracks,
    };
}

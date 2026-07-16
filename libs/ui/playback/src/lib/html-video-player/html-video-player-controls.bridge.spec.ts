/* eslint-disable max-lines */
import Hls from 'hls.js';
import { WebVideoControlsAdapter } from '../player-controls/web-video-controls.adapter';
import { HtmlVideoPlayerControlsBridge } from './html-video-player-controls.bridge';

interface VideoFixtureOptions {
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

class FakeHls {
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

interface FakeTextTrackOptions {
    kind?: string;
    label?: string;
    language?: string;
    mode?: TextTrackMode;
}

function createTextTrack(options: FakeTextTrackOptions = {}): TextTrack {
    return {
        kind: options.kind ?? 'subtitles',
        label: options.label ?? '',
        language: options.language ?? '',
        mode: options.mode ?? 'hidden',
    } as unknown as TextTrack;
}

class FakeTextTrackList {
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

function createVideo(options: VideoFixtureOptions = {}): HTMLVideoElement {
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

function readMpegtsState(options: VideoFixtureOptions, isLive = false) {
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

function bindHls(fakeHls: FakeHls, showCaptions = true) {
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

function bindNativeTracks(
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

describe('HtmlVideoPlayerControlsBridge MPEG-TS duration', () => {
    it('prefers a finite positive video duration', () => {
        const state = readMpegtsState({
            duration: 120,
            seekableEnds: [115],
            bufferedEnds: [112],
        });

        expect(state.durationSeconds).toBe(120);
        expect(state.isLive).toBe(false);
        expect(state.canSeek).toBe(true);
    });

    it('falls back to the last finite positive seekable end', () => {
        const state = readMpegtsState({
            duration: Infinity,
            seekableEnds: [90, NaN, 115],
            bufferedEnds: [112],
        });

        expect(state.durationSeconds).toBe(115);
        expect(state.isLive).toBe(false);
        expect(state.canSeek).toBe(true);
    });

    it('scans seekable ranges backward past invalid ends', () => {
        const state = readMpegtsState({
            duration: Infinity,
            seekableEnds: [105, NaN, -1],
            bufferedEnds: [112],
        });

        expect(state.durationSeconds).toBe(105);
    });

    it('falls back to the last finite positive buffered end', () => {
        const state = readMpegtsState({
            duration: Infinity,
            seekableEnds: [NaN],
            bufferedEnds: [80, NaN, 112],
        });

        expect(state.durationSeconds).toBe(112);
        expect(state.isLive).toBe(false);
        expect(state.canSeek).toBe(true);
    });

    it('returns no corrected duration when ranges throw or are invalid', () => {
        const throwingState = readMpegtsState({
            duration: Infinity,
            seekableEnds: [115],
            bufferedEnds: [112],
            seekableThrows: true,
            bufferedThrows: true,
        });
        const invalidState = readMpegtsState({
            duration: Infinity,
            seekableEnds: [NaN, -1, 0],
            bufferedEnds: [Infinity, -1, 0],
        });

        expect(throwingState.durationSeconds).toBeNull();
        expect(invalidState.durationSeconds).toBeNull();
    });

    it('keeps non-live MPEG-TS non-seekable until a seekable range exists', () => {
        const state = readMpegtsState({
            duration: Infinity,
            bufferedEnds: [112],
        });

        expect(state.durationSeconds).toBe(112);
        expect(state.isLive).toBe(false);
        expect(state.canSeek).toBe(false);
    });

    it('uses only the authoritative live input for live classification', () => {
        const liveState = readMpegtsState(
            {
                duration: 120,
                seekableEnds: [115],
            },
            true
        );
        const vodState = readMpegtsState({
            duration: Infinity,
            seekableEnds: [115],
        });

        expect(liveState.isLive).toBe(true);
        expect(liveState.durationSeconds).toBeNull();
        expect(vodState.isLive).toBe(false);
        expect(vodState.durationSeconds).toBe(115);
    });
});

describe('HtmlVideoPlayerControlsBridge lifecycle', () => {
    it('attaches the adapter exactly once with engine accessors', () => {
        const video = createVideo({ duration: 90 });
        const adapter = new WebVideoControlsAdapter();
        const attachSpy = jest.spyOn(adapter, 'attach');
        const bridge = new HtmlVideoPlayerControlsBridge({
            video,
            adapter,
            isLive: () => false,
            showCaptions: () => true,
        });

        bridge.attach();
        bridge.attach();

        expect(attachSpy).toHaveBeenCalledTimes(1);
        expect(attachSpy).toHaveBeenCalledWith(
            video,
            expect.objectContaining({
                isLive: expect.any(Function),
                getDuration: expect.any(Function),
                getAudioTracks: expect.any(Function),
                setAudioTrack: expect.any(Function),
                getSubtitleTracks: expect.any(Function),
                setSubtitleTrack: expect.any(Function),
            })
        );
        bridge.destroy();
    });

    it('lets non-MPEG-TS sources fall back to the video duration', () => {
        const adapter = new WebVideoControlsAdapter();
        const bridge = new HtmlVideoPlayerControlsBridge({
            video: createVideo({ duration: 87, seekableEnds: [80] }),
            adapter,
            isLive: () => false,
            showCaptions: () => true,
        });

        bridge.attach();
        bridge.setSource({ kind: 'native' });

        expect(adapter.state().durationSeconds).toBe(87);
        bridge.destroy();
    });

    it('clears corrected source state and refreshes authoritative inputs', () => {
        let isLive = false;
        const adapter = new WebVideoControlsAdapter();
        const bridge = new HtmlVideoPlayerControlsBridge({
            video: createVideo({
                duration: Infinity,
                seekableEnds: [115],
            }),
            adapter,
            isLive: () => isLive,
            showCaptions: () => true,
        });

        bridge.attach();
        bridge.setSource({ kind: 'mpegts' });
        expect(adapter.state().durationSeconds).toBe(115);
        expect(adapter.state().isLive).toBe(false);

        isLive = true;
        bridge.refreshInputs();
        expect(adapter.state().isLive).toBe(true);
        expect(adapter.state().durationSeconds).toBeNull();

        isLive = false;
        bridge.clearSource();
        expect(adapter.state().isLive).toBe(false);
        expect(adapter.state().durationSeconds).toBeNull();
        bridge.destroy();
    });

    it('detaches the adapter exactly once when destroyed twice', () => {
        const adapter = new WebVideoControlsAdapter();
        const detachSpy = jest.spyOn(adapter, 'detach');
        const bridge = new HtmlVideoPlayerControlsBridge({
            video: createVideo(),
            adapter,
            isLive: () => false,
            showCaptions: () => true,
        });
        bridge.attach();
        detachSpy.mockClear();

        bridge.destroy();
        bridge.destroy();

        expect(detachSpy).toHaveBeenCalledTimes(1);
    });
});

describe('HtmlVideoPlayerControlsBridge HLS tracks', () => {
    it('projects current list indices, labels, and selected audio state', () => {
        const hls = new FakeHls();
        hls.audioTracks = [
            { id: 41, name: 'English' },
            { id: 3, lang: 'de' },
            { id: 99 },
        ];
        hls.audioTrack = 1;
        const { adapter, bridge } = bindHls(hls);

        expect(adapter.state().audioTracks).toEqual([
            { id: 0, label: 'English', selected: false },
            { id: 1, label: 'de', selected: true },
            { id: 2, label: 'Audio 3', selected: false },
        ]);
        bridge.destroy();
    });

    it('selects an HLS subtitle only when display is enabled', () => {
        const hls = new FakeHls();
        hls.subtitleTracks = [
            { id: 17, name: 'English CC' },
            { id: 4, lang: 'fr' },
            { id: 88 },
        ];
        hls.subtitleTrack = 0;
        hls.subtitleDisplay = false;
        const { adapter, bridge } = bindHls(hls);

        expect(adapter.state().subtitleTracks).toEqual([
            { id: 0, label: 'English CC', selected: false },
            { id: 1, label: 'fr', selected: false },
            { id: 2, label: 'Subtitle 3', selected: false },
        ]);

        hls.subtitleDisplay = true;
        hls.emit(Hls.Events.SUBTITLE_TRACK_SWITCH);
        expect(adapter.state().subtitleTracks[0].selected).toBe(true);
        bridge.destroy();
    });

    it('accepts only valid current HLS audio indices', () => {
        const hls = new FakeHls();
        hls.audioTracks = [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }];
        hls.audioTrack = 0;
        const { adapter, bridge } = bindHls(hls);
        hls.assignments.length = 0;

        adapter.commands.setAudioTrack(2);
        expect(hls.audioTrack).toBe(2);
        expect(hls.assignments).toEqual(['audioTrack:2']);

        hls.audioTrack = 0;
        hls.assignments.length = 0;
        adapter.commands.setAudioTrack(-1);
        adapter.commands.setAudioTrack(1.5);
        adapter.commands.setAudioTrack(8);
        adapter.commands.setAudioTrack(NaN);
        hls.audioTracks = [{ name: 'One' }];
        adapter.commands.setAudioTrack(2);

        expect(hls.audioTrack).toBe(0);
        expect(hls.assignments).toEqual([]);
        bridge.destroy();
    });

    it('enables valid HLS subtitles before selection and supports explicit off', () => {
        const hls = new FakeHls();
        hls.subtitleTracks = [{ name: 'One' }, { name: 'Two' }];
        const { adapter, bridge } = bindHls(hls);
        hls.assignments.length = 0;

        adapter.commands.setSubtitleTrack(1);
        expect(hls.assignments).toEqual([
            'subtitleDisplay:true',
            'subtitleTrack:1',
        ]);
        expect(hls.subtitleDisplay).toBe(true);
        expect(hls.subtitleTrack).toBe(1);

        hls.assignments.length = 0;
        adapter.commands.setSubtitleTrack(-1);
        expect(hls.assignments).toEqual([
            'subtitleTrack:-1',
            'subtitleDisplay:false',
        ]);
        expect(hls.subtitleTrack).toBe(-1);
        expect(hls.subtitleDisplay).toBe(false);
        bridge.destroy();
    });

    it('ignores invalid and stale HLS subtitle indices', () => {
        const hls = new FakeHls();
        hls.subtitleTracks = [{ name: 'One' }, { name: 'Two' }];
        hls.subtitleTrack = 0;
        hls.subtitleDisplay = true;
        const { adapter, bridge } = bindHls(hls);
        hls.assignments.length = 0;

        adapter.commands.setSubtitleTrack(-2);
        adapter.commands.setSubtitleTrack(0.5);
        adapter.commands.setSubtitleTrack(4);
        adapter.commands.setSubtitleTrack(NaN);
        hls.subtitleTracks = [{ name: 'One' }];
        adapter.commands.setSubtitleTrack(1);

        expect(hls.subtitleTrack).toBe(0);
        expect(hls.subtitleDisplay).toBe(true);
        expect(hls.assignments).toEqual([]);
        bridge.destroy();
    });
});

describe('HtmlVideoPlayerControlsBridge HLS listener lifecycle', () => {
    const refreshEvents = [
        Hls.Events.AUDIO_TRACKS_UPDATED,
        Hls.Events.AUDIO_TRACK_SWITCHING,
        Hls.Events.AUDIO_TRACK_SWITCHED,
        Hls.Events.SUBTITLE_TRACKS_UPDATED,
        Hls.Events.SUBTITLE_TRACKS_CLEARED,
        Hls.Events.SUBTITLE_TRACK_SWITCH,
        Hls.Events.MANIFEST_LOADING,
    ];

    it('refreshes from every relevant HLS event with one callback reference', () => {
        const hls = new FakeHls();
        const adapter = new WebVideoControlsAdapter();
        const refreshSpy = jest.spyOn(adapter, 'refresh');
        const bridge = new HtmlVideoPlayerControlsBridge({
            video: createVideo(),
            adapter,
            isLive: () => false,
            showCaptions: () => true,
        });
        bridge.attach();
        bridge.setSource({ kind: 'hls', hls: hls.asHls() });

        const registrations = hls.on.mock.calls;
        expect(registrations.map(([event]) => event)).toEqual(refreshEvents);
        expect(
            new Set(registrations.map(([, listener]) => listener)).size
        ).toBe(1);

        refreshSpy.mockClear();
        for (const event of refreshEvents) {
            hls.emit(event);
        }
        expect(refreshSpy).toHaveBeenCalledTimes(refreshEvents.length);
        bridge.destroy();
    });

    it('removes exact old HLS listeners before rebinding a source', () => {
        const firstHls = new FakeHls();
        const secondHls = new FakeHls();
        const { bridge } = bindHls(firstHls);
        const firstRegistrations = [...firstHls.on.mock.calls];

        bridge.setSource({ kind: 'hls', hls: secondHls.asHls() });

        expect(firstHls.off).toHaveBeenCalledTimes(refreshEvents.length);
        for (const [event, listener] of firstRegistrations) {
            expect(firstHls.off).toHaveBeenCalledWith(event, listener);
        }
        expect(firstHls.off.mock.calls.every((call) => call.length === 2)).toBe(
            true
        );
        expect(secondHls.on.mock.calls.map(([event]) => event)).toEqual(
            refreshEvents
        );
        bridge.destroy();
    });
});

describe('HtmlVideoPlayerControlsBridge HLS caption preference', () => {
    it('suppresses initial and late HLS subtitle display while disabled', () => {
        const hls = new FakeHls();
        hls.subtitleTracks = [{ name: 'English' }];
        hls.subtitleTrack = 0;
        hls.subtitleDisplay = true;
        const { adapter, bridge } = bindHls(hls, false);

        expect(hls.subtitleDisplay).toBe(false);
        expect(adapter.state().subtitleTracks[0].selected).toBe(false);

        hls.subtitleDisplay = true;
        hls.emit(Hls.Events.SUBTITLE_TRACK_SWITCH);

        expect(hls.subtitleDisplay).toBe(false);
        expect(adapter.state().subtitleTracks[0].selected).toBe(false);
        bridge.destroy();
    });

    it('restores the retained HLS subtitle when preference returns', () => {
        const hls = new FakeHls();
        hls.subtitleTracks = [{ name: 'English' }, { name: 'German' }];
        hls.subtitleTrack = 1;
        hls.subtitleDisplay = true;
        const { adapter, bridge, captionPreference } = bindHls(hls, false);
        hls.subtitleTrack = -1;

        captionPreference.value = true;
        bridge.refreshInputs();

        expect(hls.subtitleDisplay).toBe(true);
        expect(hls.subtitleTrack).toBe(1);
        expect(adapter.state().subtitleTracks[1].selected).toBe(true);
        bridge.destroy();
    });

    it('keeps an explicit HLS selection through events and preference changes', () => {
        const hls = new FakeHls();
        hls.subtitleTracks = [{ name: 'English' }, { name: 'German' }];
        const { adapter, bridge, captionPreference } = bindHls(hls);

        adapter.commands.setSubtitleTrack(1);
        captionPreference.value = false;
        bridge.refreshInputs();
        hls.subtitleDisplay = false;
        hls.subtitleTrack = 0;
        hls.emit(Hls.Events.SUBTITLE_TRACK_SWITCH);
        captionPreference.value = true;
        bridge.refreshInputs();

        expect(hls.subtitleDisplay).toBe(true);
        expect(hls.subtitleTrack).toBe(1);
        bridge.destroy();
    });

    it('keeps explicit HLS off through events and preference changes', () => {
        const hls = new FakeHls();
        hls.subtitleTracks = [{ name: 'English' }];
        const { adapter, bridge, captionPreference } = bindHls(hls);

        adapter.commands.setSubtitleTrack(-1);
        hls.subtitleTrack = 0;
        hls.subtitleDisplay = true;
        hls.emit(Hls.Events.SUBTITLE_TRACK_SWITCH);
        captionPreference.value = false;
        bridge.refreshInputs();
        captionPreference.value = true;
        bridge.refreshInputs();

        expect(hls.subtitleTrack).toBe(-1);
        expect(hls.subtitleDisplay).toBe(false);
        bridge.destroy();
    });

    it('resets the explicit HLS override on source replacement', () => {
        const firstHls = new FakeHls();
        firstHls.subtitleTracks = [{ name: 'One' }, { name: 'Two' }];
        const { adapter, bridge } = bindHls(firstHls);
        adapter.commands.setSubtitleTrack(1);
        const secondHls = new FakeHls();
        secondHls.subtitleTracks = [{ name: 'Alpha' }, { name: 'Beta' }];
        secondHls.subtitleTrack = 0;
        secondHls.subtitleDisplay = true;

        bridge.setSource({ kind: 'hls', hls: secondHls.asHls() });

        expect(secondHls.subtitleTrack).toBe(0);
        expect(secondHls.subtitleDisplay).toBe(true);
        bridge.destroy();
    });
});

describe('HtmlVideoPlayerControlsBridge HLS subtitle event reentry', () => {
    it('settles explicit valid selection after one synchronous switch event', () => {
        const hls = new FakeHls();
        hls.subtitleTracks = [{ name: 'English' }, { name: 'German' }];
        const { adapter, bridge } = bindHls(hls);
        hls.assignments.length = 0;
        hls.enableSynchronousSubtitleTrackSwitch();

        expect(() => adapter.commands.setSubtitleTrack(1)).not.toThrow();

        expect(hls.assignments).toEqual([
            'subtitleDisplay:true',
            'subtitleTrack:1',
        ]);
        expect(hls.subtitleTrackSwitchEvents).toBe(1);
        expect(hls.subtitleDisplay).toBe(true);
        expect(hls.subtitleTrack).toBe(1);
        bridge.destroy();
    });

    it('settles explicit off after one synchronous switch event', () => {
        const hls = new FakeHls();
        hls.subtitleTracks = [{ name: 'English' }];
        hls.subtitleTrack = 0;
        hls.subtitleDisplay = true;
        const { adapter, bridge } = bindHls(hls);
        hls.assignments.length = 0;
        hls.enableSynchronousSubtitleTrackSwitch();

        expect(() => adapter.commands.setSubtitleTrack(-1)).not.toThrow();

        expect(hls.assignments).toEqual([
            'subtitleTrack:-1',
            'subtitleDisplay:false',
        ]);
        expect(hls.subtitleTrackSwitchEvents).toBe(1);
        expect(hls.subtitleTrack).toBe(-1);
        expect(hls.subtitleDisplay).toBe(false);
        bridge.destroy();
    });

    it('restores retained preference after one synchronous switch event', () => {
        const hls = new FakeHls();
        hls.subtitleTracks = [{ name: 'English' }, { name: 'German' }];
        hls.subtitleTrack = 1;
        hls.subtitleDisplay = true;
        const { bridge, captionPreference } = bindHls(hls, false);
        hls.subtitleTrack = -1;
        captionPreference.value = true;
        hls.assignments.length = 0;
        hls.enableSynchronousSubtitleTrackSwitch();

        expect(() => bridge.refreshInputs()).not.toThrow();

        expect(hls.assignments).toEqual([
            'subtitleDisplay:true',
            'subtitleTrack:1',
        ]);
        expect(hls.subtitleTrackSwitchEvents).toBe(1);
        expect(hls.subtitleDisplay).toBe(true);
        expect(hls.subtitleTrack).toBe(1);
        bridge.destroy();
    });
});

describe('HtmlVideoPlayerControlsBridge native text tracks', () => {
    it('projects only captions/subtitles with stable IDs and fallback labels', () => {
        const first = createTextTrack({
            kind: 'captions',
            label: 'English CC',
            mode: 'showing',
        });
        const ignored = createTextTrack({
            kind: 'metadata',
            label: 'Cue metadata',
            mode: 'showing',
        });
        const second = createTextTrack({
            kind: 'subtitles',
            language: 'de',
        });
        const third = createTextTrack({ kind: 'captions' });
        const { adapter, bridge, textTracks } = bindNativeTracks([
            first,
            ignored,
            second,
            third,
        ]);

        expect(adapter.state().subtitleTracks).toEqual([
            { id: 0, label: 'English CC', selected: true },
            { id: 1, label: 'de', selected: false },
            { id: 2, label: 'Subtitle 3', selected: false },
        ]);

        textTracks.remove(first);
        expect(adapter.state().subtitleTracks).toEqual([
            { id: 1, label: 'de', selected: false },
            { id: 2, label: 'Subtitle 3', selected: false },
        ]);
        bridge.destroy();
    });

    it('uses native text tracks for MPEG-TS sources too', () => {
        const subtitle = createTextTrack({
            kind: 'subtitles',
            label: 'English',
            mode: 'showing',
        });
        const { adapter, bridge } = bindNativeTracks(
            [subtitle],
            true,
            'mpegts'
        );

        expect(adapter.state().subtitleTracks).toEqual([
            { id: 0, label: 'English', selected: true },
        ]);
        bridge.destroy();
    });

    it('selects a valid native track and hides other eligible tracks', () => {
        const first = createTextTrack({
            kind: 'captions',
            mode: 'showing',
        });
        const second = createTextTrack({
            kind: 'subtitles',
            mode: 'hidden',
        });
        const ignored = createTextTrack({
            kind: 'metadata',
            mode: 'showing',
        });
        const { adapter, bridge } = bindNativeTracks([first, second, ignored]);

        adapter.commands.setSubtitleTrack(1);

        expect(first.mode).toBe('hidden');
        expect(second.mode).toBe('showing');
        expect(ignored.mode).toBe('showing');
        bridge.destroy();
    });

    it('supports explicit native subtitle off', () => {
        const first = createTextTrack({
            kind: 'captions',
            mode: 'showing',
        });
        const second = createTextTrack({
            kind: 'subtitles',
            mode: 'showing',
        });
        const { adapter, bridge } = bindNativeTracks([first, second]);

        adapter.commands.setSubtitleTrack(-1);

        expect(first.mode).toBe('hidden');
        expect(second.mode).toBe('hidden');
        bridge.destroy();
    });

    it('ignores invalid, non-integer, and stale native track IDs', () => {
        const removed = createTextTrack({
            kind: 'captions',
            mode: 'hidden',
        });
        const remaining = createTextTrack({
            kind: 'subtitles',
            mode: 'showing',
        });
        const { adapter, bridge, textTracks } = bindNativeTracks([
            removed,
            remaining,
        ]);
        textTracks.remove(removed);

        adapter.commands.setSubtitleTrack(0);
        adapter.commands.setSubtitleTrack(0.5);
        adapter.commands.setSubtitleTrack(-2);
        adapter.commands.setSubtitleTrack(8);
        adapter.commands.setSubtitleTrack(NaN);

        expect(remaining.mode).toBe('showing');
        bridge.destroy();
    });

    it('refreshes on addtrack, removetrack, and change', () => {
        const { adapter, bridge, textTracks } = bindNativeTracks([]);
        const refreshSpy = jest.spyOn(adapter, 'refresh');

        textTracks.emit('addtrack');
        textTracks.emit('removetrack');
        textTracks.emit('change');

        expect(refreshSpy).toHaveBeenCalledTimes(3);
        bridge.destroy();
    });

    it('removes exact native listener references on rebind and destroy', () => {
        const { bridge, textTracks } = bindNativeTracks([]);
        const firstRegistrations = [...textTracks.addEventListener.mock.calls];

        bridge.setSource({ kind: 'mpegts' });

        expect(textTracks.removeEventListener).toHaveBeenCalledTimes(3);
        for (const [event, listener] of firstRegistrations) {
            expect(textTracks.removeEventListener).toHaveBeenCalledWith(
                event,
                listener
            );
        }
        expect(
            textTracks.removeEventListener.mock.calls.every(
                (call) => call.length === 2
            )
        ).toBe(true);

        bridge.destroy();
        expect(textTracks.removeEventListener).toHaveBeenCalledTimes(6);
    });
});

describe('HtmlVideoPlayerControlsBridge native caption preference', () => {
    it('suppresses initial and late default captions while disabled', () => {
        const initial = createTextTrack({
            kind: 'captions',
            mode: 'showing',
        });
        const { adapter, bridge, textTracks } = bindNativeTracks(
            [initial],
            false
        );
        const late = createTextTrack({
            kind: 'subtitles',
            mode: 'showing',
        });

        expect(initial.mode).toBe('hidden');
        textTracks.add(late);

        expect(late.mode).toBe('hidden');
        expect(
            adapter.state().subtitleTracks.some((track) => track.selected)
        ).toBe(false);
        bridge.destroy();
    });

    it('restores suppressed engine/default modes when preference returns', () => {
        const initial = createTextTrack({
            kind: 'captions',
            mode: 'showing',
        });
        const untouched = createTextTrack({
            kind: 'subtitles',
            mode: 'disabled',
        });
        const { bridge, captionPreference, textTracks } = bindNativeTracks(
            [initial, untouched],
            false
        );
        const late = createTextTrack({
            kind: 'subtitles',
            mode: 'showing',
        });
        textTracks.add(late);

        captionPreference.value = true;
        bridge.refreshInputs();

        expect(initial.mode).toBe('showing');
        expect(late.mode).toBe('showing');
        expect(untouched.mode).toBe('disabled');
        bridge.destroy();
    });

    it('keeps an explicit selection through events and preference changes', () => {
        const selected = createTextTrack({
            kind: 'captions',
            mode: 'hidden',
        });
        const other = createTextTrack({
            kind: 'subtitles',
            mode: 'showing',
        });
        const { adapter, bridge, captionPreference, textTracks } =
            bindNativeTracks([selected, other]);

        adapter.commands.setSubtitleTrack(0);
        captionPreference.value = false;
        bridge.refreshInputs();
        selected.mode = 'hidden';
        other.mode = 'showing';
        textTracks.emit('change');
        captionPreference.value = true;
        bridge.refreshInputs();

        expect(selected.mode).toBe('showing');
        expect(other.mode).toBe('hidden');
        bridge.destroy();
    });

    it('keeps explicit off through events and preference changes', () => {
        const first = createTextTrack({
            kind: 'captions',
            mode: 'showing',
        });
        const second = createTextTrack({
            kind: 'subtitles',
            mode: 'hidden',
        });
        const { adapter, bridge, captionPreference, textTracks } =
            bindNativeTracks([first, second]);

        adapter.commands.setSubtitleTrack(-1);
        first.mode = 'showing';
        second.mode = 'showing';
        textTracks.emit('change');
        captionPreference.value = false;
        bridge.refreshInputs();
        captionPreference.value = true;
        bridge.refreshInputs();

        expect(first.mode).toBe('hidden');
        expect(second.mode).toBe('hidden');
        bridge.destroy();
    });

    it('resets native IDs and the explicit override on source replacement', () => {
        const first = createTextTrack({ kind: 'captions' });
        const second = createTextTrack({ kind: 'subtitles' });
        const { adapter, bridge, textTracks } = bindNativeTracks([
            first,
            second,
        ]);
        adapter.commands.setSubtitleTrack(1);
        const replacement = createTextTrack({
            kind: 'subtitles',
            mode: 'showing',
        });
        textTracks.replaceSilently([replacement]);

        bridge.setSource({ kind: 'native' });

        expect(adapter.state().subtitleTracks).toEqual([
            { id: 0, label: 'Subtitle 1', selected: true },
        ]);
        expect(replacement.mode).toBe('showing');
        bridge.destroy();
    });

    it('cleans native listeners and detaches once on double destroy', () => {
        const { adapter, bridge, textTracks } = bindNativeTracks([]);
        const detachSpy = jest.spyOn(adapter, 'detach');

        bridge.destroy();
        bridge.destroy();

        expect(textTracks.removeEventListener).toHaveBeenCalledTimes(3);
        expect(detachSpy).toHaveBeenCalledTimes(1);
    });
});

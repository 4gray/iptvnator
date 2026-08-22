import { EXTERNAL_SUBTITLE_TRACK_ID_BASE } from './web-video-external-subtitles';
import { WebVideoSourceTracks } from './web-video-source-tracks';

class FakeVTTCue {
    constructor(
        public startTime: number,
        public endTime: number,
        public text: string
    ) {}
}

class FakeTextTrack {
    kind = 'subtitles';
    mode: TextTrackMode = 'hidden';
    readonly added: FakeVTTCue[] = [];

    constructor(public label: string) {}

    addCue(cue: FakeVTTCue): void {
        this.added.push(cue);
    }

    removeCue(cue: FakeVTTCue): void {
        const index = this.added.indexOf(cue);
        if (index >= 0) {
            this.added.splice(index, 1);
        }
    }
}

const SRT_FILE = {
    name: 'movie.srt',
    format: 'srt' as const,
    content: ['1', '00:00:01,000 --> 00:00:03,000', 'Hello', ''].join('\n'),
};

function createFakeVideo() {
    return {
        textTracks: {
            length: 0,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        },
        addTextTrack: jest.fn(
            (_kind: string, label: string) => new FakeTextTrack(label)
        ),
    } as unknown as HTMLVideoElement;
}

describe('WebVideoSourceTracks external subtitle integration', () => {
    let tracks: WebVideoSourceTracks;

    beforeEach(() => {
        (globalThis as { VTTCue?: unknown }).VTTCue = FakeVTTCue;
        tracks = new WebVideoSourceTracks({
            video: createFakeVideo(),
            showCaptions: () => false,
        });
        tracks.setSource({ kind: 'native' });
    });

    afterEach(() => {
        tracks.destroy();
        delete (globalThis as { VTTCue?: unknown }).VTTCue;
    });

    it('advances the source generation on every source change', () => {
        const initial = tracks.getSourceGeneration();
        tracks.setSource({ kind: 'mpegts' });
        expect(tracks.getSourceGeneration()).toBe(initial + 1);
        tracks.clearSource();
        expect(tracks.getSourceGeneration()).toBe(initial + 2);
    });

    it('offers delay adjustment only while an external track is selected', () => {
        expect(tracks.canAdjustSubtitleDelay()).toBe(false);

        expect(tracks.addExternalSubtitleFile(SRT_FILE)).toBe(true);
        expect(tracks.canAdjustSubtitleDelay()).toBe(true);

        // Turning subtitles off deselects the external track; the delay UI
        // must retire with it — otherwise it is enabled yet visually inert.
        tracks.setSubtitleTrack(-1);
        expect(tracks.canAdjustSubtitleDelay()).toBe(false);

        tracks.setSubtitleTrack(EXTERNAL_SUBTITLE_TRACK_ID_BASE);
        expect(tracks.canAdjustSubtitleDelay()).toBe(true);
    });

    it('drops loaded external files with the source they corrected', () => {
        tracks.addExternalSubtitleFile(SRT_FILE);
        expect(tracks.getSubtitleTracks()).toHaveLength(1);

        tracks.setSource({ kind: 'native' });
        expect(tracks.getSubtitleTracks()).toHaveLength(0);
        expect(tracks.canAdjustSubtitleDelay()).toBe(false);
    });
});

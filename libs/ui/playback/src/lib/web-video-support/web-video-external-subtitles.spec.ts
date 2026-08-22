import {
    EXTERNAL_SUBTITLE_TRACK_ID_BASE,
    WebVideoExternalSubtitles,
} from './web-video-external-subtitles';
import type { ExternalSubtitleFile } from './external-subtitle-cues.util';

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

const SRT_FILE: ExternalSubtitleFile = {
    name: 'movie.srt',
    format: 'srt',
    content: [
        '1',
        '00:00:01,000 --> 00:00:03,000',
        'Hello',
        '',
        '2',
        '00:00:10,000 --> 00:00:12,000',
        'World',
        '',
    ].join('\n'),
};

describe('WebVideoExternalSubtitles', () => {
    let video: { addTextTrack: jest.Mock };
    let deselectEngineSubtitles: jest.Mock;
    let refresh: jest.Mock;
    let session: WebVideoExternalSubtitles;

    beforeEach(() => {
        (globalThis as { VTTCue?: unknown }).VTTCue = FakeVTTCue;
        video = {
            addTextTrack: jest.fn(
                (_kind: string, label: string) => new FakeTextTrack(label)
            ),
        };
        deselectEngineSubtitles = jest.fn();
        refresh = jest.fn();
        session = new WebVideoExternalSubtitles({
            getVideo: () => video as unknown as HTMLVideoElement,
            deselectEngineSubtitles,
            refresh,
        });
    });

    afterEach(() => {
        delete (globalThis as { VTTCue?: unknown }).VTTCue;
    });

    function lastTrack(): FakeTextTrack {
        return video.addTextTrack.mock.results.at(-1)?.value as FakeTextTrack;
    }

    it('creates a native track, adds cues, and selects the file', () => {
        expect(session.addFromFile(SRT_FILE)).toBe(true);

        const track = lastTrack();
        expect(video.addTextTrack).toHaveBeenCalledWith(
            'subtitles',
            'movie.srt'
        );
        expect(track.mode).toBe('showing');
        expect(track.added.map((cue) => [cue.startTime, cue.endTime])).toEqual([
            [1, 3],
            [10, 12],
        ]);
        expect(deselectEngineSubtitles).toHaveBeenCalled();
        expect(session.getTracks()).toEqual([
            {
                id: EXTERNAL_SUBTITLE_TRACK_ID_BASE,
                label: 'movie.srt',
                selected: true,
            },
        ]);
        expect(session.ownsTrack(track as unknown as TextTrack)).toBe(true);
    });

    it('rejects files that yield no usable cue', () => {
        expect(
            session.addFromFile({
                name: 'broken.srt',
                format: 'srt',
                content: 'no cues here',
            })
        ).toBe(false);
        expect(session.hasTracks()).toBe(false);
    });

    it('re-times owned cues when the delay changes and keeps originals exact', () => {
        session.addFromFile(SRT_FILE);
        const track = lastTrack();

        session.setDelay(2.5);
        expect(track.added.map((cue) => [cue.startTime, cue.endTime])).toEqual([
            [3.5, 5.5],
            [12.5, 14.5],
        ]);

        // Negative delay clamps a cue start at zero without inverting it.
        session.setDelay(-2);
        expect(track.added[0].startTime).toBe(0);
        expect(track.added[0].endTime).toBe(1);

        session.setDelay(0);
        expect(track.added.map((cue) => [cue.startTime, cue.endTime])).toEqual([
            [1, 3],
            [10, 12],
        ]);
    });

    it('keeps exactly one external track showing and deselects on demand', () => {
        session.addFromFile(SRT_FILE);
        const first = lastTrack();
        session.addFromFile({ ...SRT_FILE, name: 'other.srt' });
        const second = lastTrack();

        expect(first.mode).toBe('hidden');
        expect(second.mode).toBe('showing');

        session.select(EXTERNAL_SUBTITLE_TRACK_ID_BASE);
        expect(first.mode).toBe('showing');
        expect(second.mode).toBe('hidden');

        session.deselectAll();
        expect(first.mode).toBe('hidden');
        expect(second.mode).toBe('hidden');
    });

    it('clear() disables tracks, removes cues, and resets the delay', () => {
        session.addFromFile(SRT_FILE);
        const track = lastTrack();
        session.setDelay(1);

        session.clear();

        expect(track.mode).toBe('disabled');
        expect(track.added).toHaveLength(0);
        expect(session.hasTracks()).toBe(false);
        expect(session.getDelay()).toBe(0);
    });

    it('fails closed when the runtime lacks addTextTrack or VTTCue', () => {
        delete (globalThis as { VTTCue?: unknown }).VTTCue;
        expect(session.addFromFile(SRT_FILE)).toBe(false);
        expect(session.hasTracks()).toBe(false);
    });
});

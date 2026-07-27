import type {
    VideoJsPlayer,
    VideoJsTextTrack,
    VideoJsTextTrackList,
} from './vjs-player.types';
import { VjsTextTracks } from './vjs-text-tracks';

const TEXT_TRACK_EVENTS = [
    'addtrack',
    'removetrack',
    'change',
    'labelchange',
] as const;

describe('VjsTextTracks', () => {
    it('projects only captions and subtitles with stable per-source IDs', () => {
        const english = createTextTrack({
            kind: 'captions',
            label: 'English CC',
            mode: 'showing',
        });
        const metadata = createTextTrack({
            kind: 'metadata',
            mode: 'showing',
        });
        const german = createTextTrack({ kind: 'subtitles', language: 'de' });
        const fallback = createTextTrack({ kind: 'captions' });
        const { helper, tracks } = createBoundHelper([
            english,
            metadata,
            german,
            fallback,
        ]);

        expect(helper.getSubtitleTracks()).toEqual([
            { id: 0, label: 'English CC', selected: true },
            { id: 1, label: 'de', selected: false },
            { id: 2, label: 'Subtitle 3', selected: false },
        ]);

        tracks.remove(english);

        expect(helper.getSubtitleTracks()).toEqual([
            { id: 1, label: 'de', selected: false },
            { id: 2, label: 'Subtitle 3', selected: false },
        ]);

        tracks.add(english);

        expect(helper.getSubtitleTracks()).toEqual([
            { id: 1, label: 'de', selected: false },
            { id: 2, label: 'Subtitle 3', selected: false },
            { id: 0, label: 'English CC', selected: true },
        ]);
    });

    it('selects one valid track and disables every other VHS text track', () => {
        const first = createTextTrack({
            kind: 'captions',
            mode: 'showing',
        });
        const second = createTextTrack({
            kind: 'subtitles',
            mode: 'hidden',
        });
        const third = createTextTrack({
            kind: 'captions',
            mode: 'disabled',
        });
        const metadata = createTextTrack({
            kind: 'metadata',
            mode: 'showing',
        });
        const { helper, tracks } = createBoundHelper([
            first,
            second,
            third,
            metadata,
        ]);

        helper.setSubtitleTrack(1);

        expect(first.mode).toBe('disabled');
        expect(second.mode).toBe('showing');
        expect(third.mode).toBe('disabled');
        expect(metadata.mode).toBe('showing');

        first.mode = 'showing';
        second.mode = 'hidden';
        tracks.emit('change');

        expect(first.mode).toBe('disabled');
        expect(second.mode).toBe('showing');
        expect(third.mode).toBe('disabled');
    });

    it('treats -1 as explicit off and preserves it through later events and preferences', () => {
        const first = createTextTrack({
            kind: 'captions',
            mode: 'showing',
        });
        const second = createTextTrack({
            kind: 'subtitles',
            mode: 'hidden',
        });
        const { helper, tracks, captionPreference } = createBoundHelper([
            first,
            second,
        ]);

        helper.setSubtitleTrack(-1);
        first.mode = 'showing';
        second.mode = 'showing';
        tracks.emit('labelchange');
        captionPreference.value = false;
        helper.refreshInputs();
        captionPreference.value = true;
        helper.refreshInputs();

        expect(first.mode).toBe('disabled');
        expect(second.mode).toBe('disabled');
        const subtitles = helper.getSubtitleTracks();
        expect(subtitles.every((track) => !track.selected)).toBe(true);
    });

    it('ignores invalid, non-integer, and stale track IDs', () => {
        const removed = createTextTrack({
            kind: 'captions',
            mode: 'disabled',
        });
        const remaining = createTextTrack({
            kind: 'subtitles',
            mode: 'showing',
        });
        const { helper, tracks } = createBoundHelper([removed, remaining]);
        tracks.remove(removed);

        for (const id of [0, 0.5, -2, 8, Number.NaN]) {
            helper.setSubtitleTrack(id);
        }

        expect(remaining.mode).toBe('showing');
    });

    it('suppresses and restores the engine-selected default with the global preference', () => {
        const selected = createTextTrack({
            kind: 'captions',
            mode: 'showing',
        });
        const hidden = createTextTrack({
            kind: 'subtitles',
            mode: 'hidden',
        });
        const { helper, captionPreference } = createBoundHelper(
            [selected, hidden],
            false
        );

        expect(selected.mode).toBe('disabled');
        expect(hidden.mode).toBe('disabled');

        captionPreference.value = true;
        helper.refreshInputs();

        expect(selected.mode).toBe('showing');
        expect(hidden.mode).toBe('disabled');
    });

    it('retains a late engine default while global captions remain suppressed', () => {
        const first = createTextTrack({
            kind: 'captions',
            mode: 'showing',
        });
        const { helper, tracks, captionPreference } = createBoundHelper(
            [first],
            false
        );
        const late = createTextTrack({
            kind: 'subtitles',
            mode: 'showing',
        });

        tracks.add(late);
        captionPreference.value = true;
        helper.refreshInputs();

        expect(first.mode).toBe('disabled');
        expect(late.mode).toBe('showing');
    });

    it('keeps an explicit selection active through preference and track-list events', () => {
        const first = createTextTrack({
            kind: 'captions',
            mode: 'showing',
        });
        const second = createTextTrack({
            kind: 'subtitles',
            mode: 'disabled',
        });
        const { helper, tracks, captionPreference } = createBoundHelper([
            first,
            second,
        ]);

        helper.setSubtitleTrack(1);
        captionPreference.value = false;
        helper.refreshInputs();
        first.mode = 'showing';
        second.mode = 'hidden';
        tracks.emit('addtrack');
        captionPreference.value = true;
        helper.refreshInputs();

        expect(first.mode).toBe('disabled');
        expect(second.mode).toBe('showing');
    });

    it('resets IDs, suppression, and explicit override at a source boundary', () => {
        const first = createTextTrack({ kind: 'captions' });
        const second = createTextTrack({ kind: 'subtitles' });
        const { helper, tracks, captionPreference } = createBoundHelper([
            first,
            second,
        ]);
        helper.setSubtitleTrack(-1);
        captionPreference.value = false;
        const replacement = createTextTrack({
            kind: 'subtitles',
            mode: 'showing',
        });
        tracks.replaceSilently([replacement]);

        helper.resetSource();

        expect(helper.getSubtitleTracks()).toEqual([
            { id: 0, label: 'Subtitle 1', selected: false },
        ]);
        expect(replacement.mode).toBe('disabled');

        captionPreference.value = true;
        helper.refreshInputs();

        expect(replacement.mode).toBe('showing');
    });

    it('refreshes on all Video.js text-track events through one stable callback', () => {
        const { helper, tracks, refresh } = createBoundHelper([]);
        const registrations = [...tracks.addEventListener.mock.calls];

        for (const event of TEXT_TRACK_EVENTS) {
            tracks.emit(event);
        }

        expect(refresh).toHaveBeenCalledTimes(4);
        expect(registrations.map(([event]) => event)).toEqual(
            TEXT_TRACK_EVENTS
        );
        const listener = registrations[0][1];
        expect(registrations.every(([, entry]) => entry === listener)).toBe(
            true
        );
        helper.clear();
    });

    it('binds by list identity and removes the exact listeners once', () => {
        const firstList = new FakeTextTrackList([]);
        const secondList = new FakeTextTrackList([]);
        let currentList: VideoJsTextTrackList | null = firstList;
        const player = {
            textTracks: jest.fn(() => currentList),
        } as Pick<VideoJsPlayer, 'textTracks'>;
        const helper = new VjsTextTracks({
            player,
            showCaptions: () => true,
            refresh: jest.fn(),
        });

        helper.bind();
        const firstRegistrations = [...firstList.addEventListener.mock.calls];
        helper.bind();

        expect(firstList.addEventListener).toHaveBeenCalledTimes(4);
        expect(firstList.removeEventListener).not.toHaveBeenCalled();

        currentList = secondList;
        helper.bind();

        expect(firstList.removeEventListener).toHaveBeenCalledTimes(4);
        for (const [event, listener] of firstRegistrations) {
            expect(firstList.removeEventListener).toHaveBeenCalledWith(
                event,
                listener
            );
        }
        expect(
            firstList.removeEventListener.mock.calls.every(
                (call) => call.length === 2
            )
        ).toBe(true);

        const secondRegistrations = [...secondList.addEventListener.mock.calls];
        helper.clear();
        helper.clear();

        expect(secondList.removeEventListener).toHaveBeenCalledTimes(4);
        for (const [event, listener] of secondRegistrations) {
            expect(secondList.removeEventListener).toHaveBeenCalledWith(
                event,
                listener
            );
        }
    });
});

function createBoundHelper(
    initialTracks: VideoJsTextTrack[],
    showCaptions = true
) {
    const tracks = new FakeTextTrackList(initialTracks);
    const player = {
        textTracks: jest.fn(() => tracks),
    } as Pick<VideoJsPlayer, 'textTracks'>;
    const captionPreference = { value: showCaptions };
    const refresh = jest.fn();
    const helper = new VjsTextTracks({
        player,
        showCaptions: () => captionPreference.value,
        refresh,
    });
    helper.bind();
    refresh.mockClear();
    return { captionPreference, helper, refresh, tracks };
}

function createTextTrack(
    overrides: Partial<VideoJsTextTrack> = {}
): VideoJsTextTrack {
    return { kind: 'subtitles', mode: 'disabled', ...overrides };
}

class FakeTextTrackList implements VideoJsTextTrackList {
    [index: number]: VideoJsTextTrack;

    length = 0;
    private tracks: VideoJsTextTrack[] = [];
    private readonly listeners = new Map<
        string,
        Set<EventListenerOrEventListenerObject>
    >();

    readonly addEventListener = jest.fn(
        (type: string, listener: EventListenerOrEventListenerObject) => {
            const eventListeners = this.listeners.get(type) ?? new Set();
            eventListeners.add(listener);
            this.listeners.set(type, eventListeners);
        }
    );

    readonly removeEventListener = jest.fn(
        (type: string, listener: EventListenerOrEventListenerObject) => {
            this.listeners.get(type)?.delete(listener);
        }
    );

    constructor(initialTracks: VideoJsTextTrack[]) {
        this.replaceSilently(initialTracks);
    }

    add(track: VideoJsTextTrack): void {
        this.replaceSilently([...this.tracks, track]);
        this.emit('addtrack');
    }

    remove(track: VideoJsTextTrack): void {
        this.replaceSilently(this.tracks.filter((entry) => entry !== track));
        this.emit('removetrack');
    }

    replaceSilently(tracks: VideoJsTextTrack[]): void {
        for (let index = 0; index < this.length; index += 1) {
            delete this[index];
        }
        this.tracks = [...tracks];
        this.length = tracks.length;
        tracks.forEach((track, index) => {
            this[index] = track;
        });
    }

    emit(type: string): void {
        const event = new Event(type);
        for (const listener of this.listeners.get(type) ?? []) {
            if (typeof listener === 'function') {
                listener(event);
            } else {
                listener.handleEvent(event);
            }
        }
    }
}

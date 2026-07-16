import {
    bindNativeTracks,
    createTextTrack,
} from './html-video-player-controls.spec-fixtures';

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

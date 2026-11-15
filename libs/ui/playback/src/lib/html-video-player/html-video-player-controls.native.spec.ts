import {
    bindNativeTracks,
    createTextTrack,
} from './html-video-player-controls.spec-fixtures';

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

import Hls from 'hls.js';
import { WebVideoControlsAdapter } from '../player-controls/web-video-controls.adapter';
import { HtmlVideoPlayerControlsBridge } from './html-video-player-controls.bridge';
import {
    bindHls,
    createVideo,
    FakeHls,
} from './html-video-player-controls.spec-fixtures';

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

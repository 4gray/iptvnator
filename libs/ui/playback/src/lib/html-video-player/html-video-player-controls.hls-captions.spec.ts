import Hls from 'hls.js';
import { bindHls, FakeHls } from './html-video-player-controls.spec-fixtures';

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

    it('restores an HLS default selected while display remains disabled', () => {
        const hls = new FakeHls();
        const { bridge, captionPreference } = bindHls(hls, false);
        hls.subtitleTracks = [{ name: 'English' }];
        hls.subtitleTrack = 0;
        hls.emit(Hls.Events.SUBTITLE_TRACK_SWITCH);

        expect(hls.subtitleDisplay).toBe(false);

        captionPreference.value = true;
        bridge.refreshInputs();

        expect(hls.subtitleTrack).toBe(0);
        expect(hls.subtitleDisplay).toBe(true);
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

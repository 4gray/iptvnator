import type { WebVideoControlsAdapter } from './web-video-controls.adapter';
import {
    attachWebVideoControls,
    toPlayerTracks,
} from './web-video-controls.host';

describe('attachWebVideoControls', () => {
    it('attaches the adapter to the video with the supplied options', () => {
        const adapter = { attach: jest.fn() } as unknown as jest.Mocked<
            Pick<WebVideoControlsAdapter, 'attach'>
        >;
        const video = document.createElement('video');
        const options = { isLive: () => true };

        attachWebVideoControls({
            video,
            adapter: adapter as unknown as WebVideoControlsAdapter,
            options,
        });

        expect(adapter.attach).toHaveBeenCalledWith(video, options);
    });

    it('defaults omitted options to an empty object', () => {
        const adapter = { attach: jest.fn() } as unknown as jest.Mocked<
            Pick<WebVideoControlsAdapter, 'attach'>
        >;
        const video = document.createElement('video');

        attachWebVideoControls({
            video,
            adapter: adapter as unknown as WebVideoControlsAdapter,
        });

        expect(adapter.attach).toHaveBeenCalledWith(video, {});
    });
});

describe('toPlayerTracks', () => {
    it('projects entries onto plain PlayerTrack objects', () => {
        const entries = [
            { id: 0, label: 'English', selected: true, extra: 'ignored' },
            { id: 1, label: 'German', selected: false },
        ];

        const tracks = toPlayerTracks(entries);

        expect(tracks).toEqual([
            { id: 0, label: 'English', selected: true },
            { id: 1, label: 'German', selected: false },
        ]);
        // New objects, no engine-specific extras leaking through.
        expect(tracks[0]).not.toBe(entries[0]);
        expect('extra' in tracks[0]).toBe(false);
    });

    it('maps an empty list to an empty list', () => {
        expect(toPlayerTracks([])).toEqual([]);
    });
});

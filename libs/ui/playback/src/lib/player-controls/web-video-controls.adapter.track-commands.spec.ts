import type { PlayerTrack } from './player-controls.model';
import { WebVideoControlsAdapter } from './web-video-controls.adapter';

interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
    reject: (reason: unknown) => void;
}

function createDeferred(): Deferred {
    let resolvePromise!: () => void;
    let rejectPromise!: (reason: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return {
        promise,
        resolve: resolvePromise,
        reject: rejectPromise,
    };
}

function createVideo(): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperties(video, {
        duration: {
            configurable: true,
            value: 120,
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
            value: true,
        },
        seekable: {
            configurable: true,
            value: { length: 1 },
        },
    });
    return video;
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('WebVideoControlsAdapter async track commands', () => {
    let adapter: WebVideoControlsAdapter;

    beforeEach(() => {
        adapter = new WebVideoControlsAdapter();
    });

    afterEach(() => adapter.detach());

    it('refreshes track state only after an async setter fulfills', async () => {
        let tracks: PlayerTrack[] = [
            { id: 1, label: 'English', selected: true },
            { id: 2, label: 'German', selected: false },
        ];
        const deferred = createDeferred();
        const setAudioTrack = jest.fn(() => deferred.promise);
        adapter.attach(createVideo(), {
            getAudioTracks: () => tracks,
            setAudioTrack,
        });
        expect(adapter.state().audioTracks[0].selected).toBe(true);

        adapter.commands.setAudioTrack(2);
        tracks = tracks.map((track) => ({
            ...track,
            selected: track.id === 2,
        }));
        expect(adapter.state().audioTracks[0].selected).toBe(true);

        deferred.resolve();
        await flushPromises();

        expect(setAudioTrack).toHaveBeenCalledWith(2);
        expect(adapter.state().audioTracks[1].selected).toBe(true);
    });

    it('swallows an async setter rejection without refreshing state', async () => {
        const tracks: PlayerTrack[] = [
            { id: 1, label: 'English', selected: true },
            { id: 2, label: 'German', selected: false },
        ];
        const deferred = createDeferred();
        const setAudioTrack = jest.fn(() => deferred.promise);
        adapter.attach(createVideo(), {
            getAudioTracks: () => tracks,
            setAudioTrack,
        });
        const stateBefore = adapter.state();

        adapter.commands.setAudioTrack(2);
        deferred.reject(new Error('engine rejected selection'));
        await flushPromises();

        expect(setAudioTrack).toHaveBeenCalledWith(2);
        expect(adapter.state()).toBe(stateBefore);
    });

    it('swallows a synchronous setter exception', () => {
        const setSubtitleTrack = jest.fn(() => {
            throw new Error('engine changing source');
        });
        adapter.attach(createVideo(), {
            getSubtitleTracks: () => [
                { id: 3, label: 'English', selected: false },
            ],
            setSubtitleTrack,
        });

        expect(() => adapter.commands.setSubtitleTrack(3)).not.toThrow();
        expect(setSubtitleTrack).toHaveBeenCalledWith(3);
    });
});

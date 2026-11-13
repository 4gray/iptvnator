import { WebPlayerTileMedia } from './web-player-tile-media';

const flushMutations = () =>
    new Promise<void>((resolve) => setTimeout(resolve));

describe('WebPlayerTileMedia', () => {
    let root: HTMLElement;
    let media: WebPlayerTileMedia | null;
    let audioRequested: jest.Mock;
    let now: number;
    let play: jest.SpyInstance;
    let pause: jest.SpyInstance;
    const pausedState = new WeakMap<HTMLMediaElement, boolean>();

    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
        audioRequested = jest.fn();
        now = 10_000;
        media = null;
        // jsdom implements neither play() nor pause(); track the state here.
        play = jest
            .spyOn(HTMLMediaElement.prototype, 'play')
            .mockImplementation(function (this: HTMLMediaElement) {
                pausedState.set(this, false);
                this.dispatchEvent(new Event('play'));
                return Promise.resolve();
            });
        pause = jest
            .spyOn(HTMLMediaElement.prototype, 'pause')
            .mockImplementation(function (this: HTMLMediaElement) {
                pausedState.set(this, true);
            });
        jest.spyOn(
            HTMLMediaElement.prototype,
            'paused',
            'get'
        ).mockImplementation(function (this: HTMLMediaElement) {
            return pausedState.get(this) ?? true;
        });
    });

    afterEach(() => {
        media?.destroy();
        root.remove();
        jest.restoreAllMocks();
    });

    function create(): WebPlayerTileMedia {
        media = new WebPlayerTileMedia({
            root,
            onAudioRequested: audioRequested,
            now: () => now,
        });
        return media;
    }

    function addVideo(parent: HTMLElement = root): HTMLVideoElement {
        const video = document.createElement('video');
        parent.appendChild(video);
        return video;
    }

    describe('muted', () => {
        it('mutes the videos already in the view', () => {
            const video = addVideo();
            create().sync(true, null);

            expect(video.muted).toBe(true);
        });

        it('mutes a video an engine mounts later, deep in the view', async () => {
            const tile = create();
            tile.sync(true, null);
            const nested = document.createElement('div');
            root.appendChild(nested);
            const video = addVideo(nested);
            await flushMutations();

            expect(video.muted).toBe(true);
        });

        it('unmutes when the tile gets the audio', () => {
            const video = addVideo();
            const tile = create();
            tile.sync(true, null);
            tile.sync(false, null);

            expect(video.muted).toBe(false);
        });

        it('leaves a newly mounted video alone while the tile has audio', async () => {
            create().sync(false, null);
            const video = addVideo();
            video.muted = true;
            await flushMutations();

            expect(video.muted).toBe(true);
        });

        it('re-mutes an engine that unmutes itself, without asking for audio', () => {
            const video = addVideo();
            create().sync(true, null);

            video.muted = false;
            video.dispatchEvent(new Event('volumechange'));

            expect(video.muted).toBe(true);
            expect(audioRequested).not.toHaveBeenCalled();
        });

        it('asks for the audio when the viewer unmutes the tile (D3)', () => {
            const video = addVideo();
            create().sync(true, null);

            root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            video.muted = false;
            video.dispatchEvent(new Event('volumechange'));

            expect(audioRequested).toHaveBeenCalledTimes(1);
            expect(video.muted).toBe(true);
        });

        it('does not count an interaction outside the tile', () => {
            const video = addVideo();
            create().sync(true, null);

            document.body.dispatchEvent(
                new Event('pointerdown', { bubbles: true })
            );
            video.muted = false;
            video.dispatchEvent(new Event('volumechange'));

            expect(audioRequested).not.toHaveBeenCalled();
        });

        it('does not count an interaction that is too old', () => {
            const video = addVideo();
            create().sync(true, null);

            root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
            now += 5_000;
            video.muted = false;
            video.dispatchEvent(new Event('volumechange'));

            expect(audioRequested).not.toHaveBeenCalled();
        });

        it('respects the viewer muting the audio tile', () => {
            const video = addVideo();
            create().sync(false, null);

            root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            video.muted = true;
            video.dispatchEvent(new Event('volumechange'));

            expect(video.muted).toBe(true);
            expect(audioRequested).not.toHaveBeenCalled();
        });
    });

    describe('paused', () => {
        it('pauses a playing video when the tile is held', () => {
            const video = addVideo();
            void video.play();
            create().sync(null, true);

            expect(pause).toHaveBeenCalled();
            expect(video.paused).toBe(true);
        });

        it('resumes once the hold is released', () => {
            const video = addVideo();
            const tile = create();
            tile.sync(null, true);
            play.mockClear();
            tile.sync(null, false);

            expect(play).toHaveBeenCalledTimes(1);
            expect(video.paused).toBe(false);
        });

        it('never starts a video that was not held', () => {
            addVideo();
            create().sync(null, false);

            expect(play).not.toHaveBeenCalled();
        });

        it('pauses an engine that starts playing while held', () => {
            const video = addVideo();
            create().sync(null, true);
            pause.mockClear();

            void video.play();

            expect(pause).toHaveBeenCalledTimes(1);
            expect(audioRequested).not.toHaveBeenCalled();
        });

        it('asks for the audio when the viewer plays a held tile', () => {
            const video = addVideo();
            create().sync(null, true);
            pause.mockClear();

            root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            void video.play();

            expect(audioRequested).toHaveBeenCalledTimes(1);
            expect(pause).not.toHaveBeenCalled();
        });
    });

    it('stops managing videos once destroyed', async () => {
        const video = addVideo();
        const tile = create();
        tile.sync(true, true);
        tile.destroy();
        media = null;

        video.muted = false;
        video.dispatchEvent(new Event('volumechange'));
        const later = addVideo();
        await flushMutations();

        expect(video.muted).toBe(false);
        expect(later.muted).toBe(false);
    });
});

import type Artplayer from 'artplayer';
import { ArtPlayerVideoSession } from './art-player-video-session';

describe('ArtPlayerVideoSession', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('owns ready, time, ended, and native diagnostic propagation', () => {
        const player = createPlayer();
        const issues: unknown[] = [];
        const times: unknown[] = [];
        const ended = jest.fn();
        const session = new ArtPlayerVideoSession({
            player,
            sourceUrl: 'https://example.test/movie.mkv',
            getStartTime: () => 42,
            getDuration: () => player.duration,
            persistSharedVolume: false,
            emitPlaybackIssue: (issue) => issues.push(issue),
            emitTimeUpdate: (value) => times.push(value),
            emitPlaybackEnded: ended,
        });
        session.attach();

        player.emit('ready');
        expect(player.seek).toBe(42);

        player.currentTime = 45;
        player.duration = 120;
        player.emit('video:timeupdate');
        expect(times).toEqual([{ currentTime: 45, duration: 120 }]);

        Object.defineProperty(player.video, 'error', {
            configurable: true,
            value: { code: 4, message: 'unsupported source' },
        });
        player.video.dispatchEvent(new Event('error'));
        expect(issues.at(-1)).toEqual(
            expect.objectContaining({
                code: 'unsupported-container',
                sourceUrl: 'https://example.test/movie.mkv',
                player: 'artplayer',
            })
        );

        player.video.dispatchEvent(new Event('loadeddata'));
        player.video.dispatchEvent(new Event('playing'));
        player.video.dispatchEvent(new Event('ended'));
        expect(issues.slice(-2)).toEqual([null, null]);
        expect(ended).toHaveBeenCalledTimes(1);
    });

    it('persists shared-control volume without changing legacy storage behavior', () => {
        const sharedPlayer = createPlayer();
        const sharedSession = createSession(sharedPlayer, true);
        sharedSession.attach();
        sharedPlayer.video.volume = 0.35;
        sharedPlayer.video.dispatchEvent(new Event('volumechange'));
        expect(localStorage.getItem('volume')).toBe('0.35');

        localStorage.removeItem('volume');
        const legacyPlayer = createPlayer();
        const legacySession = createSession(legacyPlayer, false);
        legacySession.attach();
        legacyPlayer.video.volume = 0.7;
        legacyPlayer.video.dispatchEvent(new Event('volumechange'));
        expect(localStorage.getItem('volume')).toBeNull();
    });

    it('uses the source-resolved duration for time updates', () => {
        const player = createPlayer();
        const times: Array<{ currentTime: number; duration: number }> = [];
        player.currentTime = 45;
        player.duration = Number.POSITIVE_INFINITY;
        const session = new ArtPlayerVideoSession({
            player,
            sourceUrl: 'https://example.test/movie.ts',
            getStartTime: () => 0,
            getDuration: () => 135,
            persistSharedVolume: true,
            emitPlaybackIssue: () => undefined,
            emitTimeUpdate: (value) => times.push(value),
            emitPlaybackEnded: () => undefined,
        });
        session.attach();

        player.emit('video:timeupdate');

        expect(times).toEqual([{ currentTime: 45, duration: 135 }]);
    });

    it('removes native and ArtPlayer listeners exactly on destroy', () => {
        const player = createPlayer();
        const ended = jest.fn();
        const session = new ArtPlayerVideoSession({
            player,
            sourceUrl: 'https://example.test/movie.mp4',
            getStartTime: () => 0,
            getDuration: () => player.duration,
            persistSharedVolume: true,
            emitPlaybackIssue: () => undefined,
            emitTimeUpdate: () => undefined,
            emitPlaybackEnded: ended,
        });
        const removeEventListener = jest.spyOn(
            player.video,
            'removeEventListener'
        );
        session.attach();

        session.destroy();
        session.destroy();
        player.video.dispatchEvent(new Event('ended'));
        player.emit('video:timeupdate');

        expect(removeEventListener).toHaveBeenCalledWith(
            'ended',
            expect.any(Function)
        );
        expect(player.off).toHaveBeenCalledWith('ready', expect.any(Function));
        expect(player.off).toHaveBeenCalledWith(
            'video:timeupdate',
            expect.any(Function)
        );
        expect(ended).not.toHaveBeenCalled();
    });
});

function createSession(
    player: MockArtplayer,
    persistSharedVolume: boolean
): ArtPlayerVideoSession {
    return new ArtPlayerVideoSession({
        player,
        sourceUrl: 'https://example.test/movie.mp4',
        getStartTime: () => 0,
        getDuration: () => player.duration,
        persistSharedVolume,
        emitPlaybackIssue: () => undefined,
        emitTimeUpdate: () => undefined,
        emitPlaybackEnded: () => undefined,
    });
}

class MockArtplayer {
    readonly video = document.createElement('video');
    readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    readonly on = jest.fn(
        (event: string, handler: (...args: unknown[]) => void) => {
            const handlers = this.handlers.get(event) ?? [];
            handlers.push(handler);
            this.handlers.set(event, handlers);
            return this;
        }
    );
    readonly off = jest.fn(
        (event: string, handler: (...args: unknown[]) => void) => {
            const handlers = this.handlers.get(event) ?? [];
            this.handlers.set(
                event,
                handlers.filter((candidate) => candidate !== handler)
            );
            return this;
        }
    );
    currentTime = 0;
    duration = 0;
    seek = 0;

    emit(event: string, ...args: unknown[]): void {
        for (const handler of this.handlers.get(event) ?? []) {
            handler(...args);
        }
    }
}

function createPlayer(): MockArtplayer & Artplayer {
    return new MockArtplayer() as MockArtplayer & Artplayer;
}

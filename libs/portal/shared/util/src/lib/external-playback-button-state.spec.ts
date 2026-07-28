import { signal } from '@angular/core';
import type {
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import { createExternalPlaybackButtonState } from './external-playback-button-state';

function session(
    overrides: Partial<ExternalPlayerSession> = {}
): ExternalPlayerSession {
    return {
        player: 'mpv',
        status: 'playing',
        contentInfo: {
            playlistId: 'playlist-1',
            contentXtreamId: 42,
            contentType: 'vod',
        },
        ...overrides,
    } as ExternalPlayerSession;
}

function setup(initial: ExternalPlayerSession | null = null) {
    const current = signal<ExternalPlayerSession | null>(initial);
    const api = createExternalPlaybackButtonState({
        session: current,
        playlistId: signal<string | null>('playlist-1'),
        contentId: signal<number | null>(42),
    });
    return { current, api };
}

describe('createExternalPlaybackButtonState', () => {
    it('is idle with no session', () => {
        const { api } = setup(null);

        expect(api.matchedSession()).toBeNull();
        expect(api.buttonState()).toBe('idle');
        expect(api.primaryIcon()).toBe('play_arrow');
        expect(api.primaryLabel()).toBeNull();
    });

    it('matches a session for the item on screen', () => {
        const { api } = setup(session());

        expect(api.matchedSession()).not.toBeNull();
        expect(api.buttonState()).toBe('stop');
        expect(api.primaryIcon()).toBe('stop_circle');
        expect(api.primaryLabel()).toBe('Stop MPV');
        expect(api.isStopAction()).toBe(true);
    });

    it('ignores a session playing a different movie', () => {
        // The whole point of the match: another movie playing in MPV must not
        // turn this page's Play button into Stop.
        const { api } = setup(
            session({
                contentInfo: {
                    playlistId: 'playlist-1',
                    contentXtreamId: 999,
                    contentType: 'vod',
                },
            } as Partial<ExternalPlayerSession>)
        );

        expect(api.matchedSession()).toBeNull();
        expect(api.buttonState()).toBe('idle');
    });

    it('ignores a session from a different playlist', () => {
        const { api } = setup(
            session({
                contentInfo: {
                    playlistId: 'other-playlist',
                    contentXtreamId: 42,
                    contentType: 'vod',
                },
            } as Partial<ExternalPlayerSession>)
        );

        expect(api.matchedSession()).toBeNull();
    });

    it('ignores a session of a different content type', () => {
        const { api } = setup(
            session({
                contentInfo: {
                    playlistId: 'playlist-1',
                    contentXtreamId: 42,
                    contentType: 'episode',
                },
            } as Partial<ExternalPlayerSession>)
        );

        expect(api.matchedSession()).toBeNull();
    });

    it.each(['closed', 'error'] as const)(
        'treats a %s session as nothing playing',
        (status) => {
            const { api } = setup(session({ status }));

            expect(api.matchedSession()).toBeNull();
            expect(api.buttonState()).toBe('idle');
        }
    );

    it('reports a launching session', () => {
        const { api } = setup(session({ status: 'launching' }));

        expect(api.buttonState()).toBe('launching');
        expect(api.primaryIcon()).toBe('hourglass_top');
        expect(api.primaryLabel()).toBe('Opening in MPV...');
        expect(api.isLaunchPending()).toBe(true);
        expect(api.isStopAction()).toBe(false);
    });

    it('reacts to the session changing', () => {
        const { current, api } = setup(null);
        expect(api.buttonState()).toBe('idle');

        current.set(session({ status: 'launching' }));
        expect(api.buttonState()).toBe('launching');

        current.set(session({ status: 'playing' }));
        expect(api.buttonState()).toBe('stop');

        current.set(null);
        expect(api.buttonState()).toBe('idle');
    });

    it('does not match while the item id is unknown', () => {
        const api = createExternalPlaybackButtonState({
            session: signal<ExternalPlayerSession | null>(session()),
            playlistId: signal<string | null>('playlist-1'),
            contentId: signal<number | null>(null),
        });

        expect(api.matchedSession()).toBeNull();
    });

    it('also owns a session launched for another playlist it switched to', () => {
        // Multi-source: same film, other playlist, other stream id. Without
        // this the page shows Play while its own switch is streaming, and
        // clicking it opens a second player instead of stopping the first.
        const api = createExternalPlaybackButtonState({
            session: signal<ExternalPlayerSession | null>(
                session({
                    contentInfo: {
                        playlistId: 'playlist-2',
                        contentXtreamId: 991,
                        contentType: 'vod',
                    },
                })
            ),
            playlistId: signal<string | null>('playlist-1'),
            contentId: signal<number | null>(42),
            alsoOwns: signal<PlayerContentInfo | null>({
                playlistId: 'playlist-2',
                contentXtreamId: 991,
                contentType: 'vod',
            }),
        });

        expect(api.matchedSession()).not.toBeNull();
        expect(api.isStopAction()).toBe(true);
    });

    it('disowns that session once playback moved back', () => {
        const api = createExternalPlaybackButtonState({
            session: signal<ExternalPlayerSession | null>(
                session({
                    contentInfo: {
                        playlistId: 'playlist-2',
                        contentXtreamId: 991,
                        contentType: 'vod',
                    },
                })
            ),
            playlistId: signal<string | null>('playlist-1'),
            contentId: signal<number | null>(42),
            alsoOwns: signal<PlayerContentInfo | null>(null),
        });

        expect(api.matchedSession()).toBeNull();
    });

    it('still checks the content type of an owned alternative', () => {
        const api = createExternalPlaybackButtonState({
            session: signal<ExternalPlayerSession | null>(
                session({
                    contentInfo: {
                        playlistId: 'playlist-2',
                        contentXtreamId: 991,
                        contentType: 'episode',
                    },
                })
            ),
            playlistId: signal<string | null>('playlist-1'),
            contentId: signal<number | null>(42),
            alsoOwns: signal<PlayerContentInfo | null>({
                playlistId: 'playlist-2',
                contentXtreamId: 991,
                contentType: 'vod',
            }),
        });

        expect(api.matchedSession()).toBeNull();
    });
});

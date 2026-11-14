import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import type { MultiviewTileSource } from './multiview-session.model';
import {
    MultiviewSessionStore,
    supportsMultiview,
} from './multiview-session.store';

function source(
    key: string,
    kind: MultiviewTileSource['kind'] = 'live'
): MultiviewTileSource {
    return {
        playback: {
            streamUrl: `https://stream.example/${key}.m3u8`,
            title: `Title ${key}`,
        },
        playbackSessionKey: `session:${key}`,
        kind,
        playlistId: 'playlist-1',
        title: `Title ${key}`,
    };
}

describe('MultiviewSessionStore', () => {
    let store: MultiviewSessionStore;
    const player = signal<VideoPlayer>(VideoPlayer.VideoJs);

    beforeEach(() => {
        player.set(VideoPlayer.VideoJs);
        TestBed.configureTestingModule({
            providers: [{ provide: SettingsStore, useValue: { player } }],
        });
        store = TestBed.inject(MultiviewSessionStore);
    });

    function startSession(): void {
        store.start(
            'anchor-1',
            source('movie', 'vod'),
            VideoPlayer.VideoJs,
            source('match')
        );
    }

    it('exposes no session by default', () => {
        expect(store.exists()).toBe(false);
        expect(store.tiles()).toEqual([]);
        expect(store.autoplayNextEpisodeAllowed()).toBe(true);
        expect(store.badgeFor('session:movie')).toBeNull();
    });

    it('creates a session with unique tile ids', () => {
        startSession();

        const ids = store.tiles().map((tile) => tile.id);
        expect(store.exists()).toBe(true);
        expect(new Set(ids).size).toBe(2);
        expect(store.audioTileId()).toBe(ids[0]);
        expect(store.activeTileId()).toBe(ids[0]);
        expect(store.anchorId()).toBe('anchor-1');
        expect(store.layout()).toBe('pip');
    });

    it('never reuses a tile id after a replacement or a new session', () => {
        startSession();
        const first = store.tiles().map((tile) => tile.id);
        store.exit();
        startSession();
        store.add(source('news'));

        const second = store.tiles().map((tile) => tile.id);
        expect(second.some((id) => first.includes(id))).toBe(false);
    });

    it('stops episode autoplay while a session exists (D11)', () => {
        startSession();
        expect(store.autoplayNextEpisodeAllowed()).toBe(false);

        store.exit();
        expect(store.autoplayNextEpisodeAllowed()).toBe(true);
    });

    it('reports badges with the tile number and audio', () => {
        startSession();
        store.swap();

        expect(store.badgeFor('session:match')).toEqual({
            tileNumber: 1,
            hasAudio: true,
        });
        expect(store.badgeFor('session:movie')).toEqual({
            tileNumber: 2,
            hasAudio: false,
        });
    });

    it('holds the muted VOD tile paused and lets it play with audio', () => {
        startSession();
        const [movie] = store.tiles();

        expect(store.isHeldPaused(movie.id)).toBe(false);
        store.swap();
        expect(store.isHeldPaused(movie.id)).toBe(true);
        expect(store.isMuted(movie.id)).toBe(true);
    });

    it('publishes every effect as a numbered notice', () => {
        startSession();
        store.add(source('news'));
        const first = store.notice();
        store.add(source('doc'));

        expect(first?.effect.type).toBe('replaced');
        expect(store.notice()?.sequence).toBe((first?.sequence ?? 0) + 1);
    });

    it('returns rejections to the caller without changing the session', () => {
        startSession();
        const before = store.state();

        expect(store.add(source('match'))).toEqual({
            type: 'rejected',
            reason: 'already-on-screen',
        });
        expect(store.state()).toBe(before);
    });

    it.each([VideoPlayer.MPV, VideoPlayer.VLC, VideoPlayer.EmbeddedMpv])(
        'ends the session when Settings switch to %s',
        (unsupported) => {
            startSession();
            const [main] = store.tiles();

            player.set(unsupported);
            TestBed.tick();

            expect(store.exists()).toBe(false);
            expect(store.notice()?.effect).toEqual({
                type: 'ended',
                reason: 'player-unsupported',
                survivor: main,
            });
        }
    );

    it('keeps the session when Settings switch between built-in players', () => {
        startSession();

        player.set(VideoPlayer.ArtPlayer);
        TestBed.tick();

        expect(store.exists()).toBe(true);
    });

    it('lets an unsupported player stay selected without a session', () => {
        player.set(VideoPlayer.MPV);
        TestBed.tick();

        expect(store.notice()).toBeNull();
    });
});

describe('supportsMultiview', () => {
    it.each([
        [VideoPlayer.VideoJs, true],
        [VideoPlayer.Html5Player, true],
        [VideoPlayer.ArtPlayer, true],
        [VideoPlayer.MPV, false],
        [VideoPlayer.VLC, false],
        [VideoPlayer.EmbeddedMpv, false],
        [null, true],
    ])('%s → %s', (player, expected) => {
        expect(supportsMultiview(player)).toBe(expected);
    });
});

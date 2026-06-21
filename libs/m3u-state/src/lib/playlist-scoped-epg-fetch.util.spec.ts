import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { resolvePlaylistScopedEpgFetchPlan } from './playlist-scoped-epg-fetch.util';

function createPlaylistMeta(
    overrides: Partial<PlaylistMeta> = {}
): PlaylistMeta {
    return {
        _id: 'playlist-1',
        title: 'Playlist',
        count: 1,
        importDate: '2026-06-21T10:00:00.000Z',
        autoRefresh: false,
        epgUrls: [],
        ...overrides,
    };
}

describe('resolvePlaylistScopedEpgFetchPlan', () => {
    it('does not refetch when playlist metadata changes without fetchable EPG URL changes', () => {
        const playlist = createPlaylistMeta({
            title: 'Renamed playlist',
            epgUrls: ['https://playlist.example.com/guide.xml'],
        });

        expect(
            resolvePlaylistScopedEpgFetchPlan(
                playlist,
                [],
                'https://playlist.example.com/guide.xml'
            )
        ).toEqual({
            key: 'https://playlist.example.com/guide.xml',
            shouldFetch: false,
            urls: ['https://playlist.example.com/guide.xml'],
        });
    });

    it('does not fetch playlist EPG URLs that are already configured globally', () => {
        const playlist = createPlaylistMeta({
            epgUrls: [
                'https://global.example.com/guide.xml',
                'https://playlist.example.com/guide.xml',
            ],
        });

        expect(
            resolvePlaylistScopedEpgFetchPlan(playlist, [
                ' https://global.example.com/guide.xml ',
            ])
        ).toEqual({
            key: 'https://playlist.example.com/guide.xml',
            shouldFetch: true,
            urls: ['https://playlist.example.com/guide.xml'],
        });
    });

    it('keeps the previous fetch key when a partial playlist metadata update omits EPG URLs', () => {
        expect(
            resolvePlaylistScopedEpgFetchPlan(
                {},
                [],
                'https://playlist.example.com/guide.xml'
            )
        ).toEqual({
            key: 'https://playlist.example.com/guide.xml',
            shouldFetch: false,
            urls: [],
        });
    });

    it('does not refetch remaining playlist EPG URLs when one local source is disabled', () => {
        const playlist = createPlaylistMeta({
            epgUrls: ['https://playlist.example.com/keep.xml'],
        });

        expect(
            resolvePlaylistScopedEpgFetchPlan(
                playlist,
                [],
                [
                    'https://playlist.example.com/keep.xml',
                    'https://playlist.example.com/remove.xml',
                ].join('\n')
            )
        ).toEqual({
            key: 'https://playlist.example.com/keep.xml',
            shouldFetch: false,
            urls: ['https://playlist.example.com/keep.xml'],
        });
    });

    it('fetches only newly added playlist EPG URLs when the local source set expands', () => {
        const playlist = createPlaylistMeta({
            epgUrls: [
                'https://playlist.example.com/keep.xml',
                'https://playlist.example.com/new.xml',
            ],
        });

        expect(
            resolvePlaylistScopedEpgFetchPlan(
                playlist,
                [],
                'https://playlist.example.com/keep.xml'
            )
        ).toEqual({
            key: [
                'https://playlist.example.com/keep.xml',
                'https://playlist.example.com/new.xml',
            ].join('\n'),
            shouldFetch: true,
            urls: ['https://playlist.example.com/new.xml'],
        });
    });

    it('fetches all playlist EPG URLs when refresh is forced for an already fetched source set', () => {
        const playlist = createPlaylistMeta({
            epgUrls: [
                'https://playlist.example.com/keep.xml',
                'https://playlist.example.com/other.xml',
            ],
        });
        const key = [
            'https://playlist.example.com/keep.xml',
            'https://playlist.example.com/other.xml',
        ].join('\n');

        expect(
            resolvePlaylistScopedEpgFetchPlan(playlist, [], key, {
                force: true,
            })
        ).toEqual({
            key,
            shouldFetch: true,
            urls: [
                'https://playlist.example.com/keep.xml',
                'https://playlist.example.com/other.xml',
            ],
        });
    });
});

import { signal } from '@angular/core';
import {
    selectActive,
    selectActiveEpgProgram,
    selectActivePlaybackUrl,
    selectChannels,
    selectChannelsLoading,
    selectCurrentEpgProgram,
    selectFavorites,
} from '@iptvnator/m3u-state';
import {
    Channel,
    EpgProgram,
    ExternalPlayerSession,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { BehaviorSubject, of } from 'rxjs';

/**
 * Shared state and collaborator mocks for the `VideoPlayerComponent` spec.
 * They live beside the spec rather than inside it because the suite is at the
 * 1200-line test cap; the signals are module singletons, which is safe because
 * Jest gives every spec file its own module registry.
 */
export const playlistId = signal('playlist-1');
export const activeChannel = signal<Channel | null>(null);
export const activePlaybackUrl = signal<string | null>(null);
export const channels = signal<Channel[]>([]);
export const channelsLoading = signal(false);
export const currentEpgProgram = signal<EpgProgram | null>(null);
export const activeEpgProgram = signal<EpgProgram | null>(null);
export const favoriteIds = signal<string[]>([]);

export const channels$ = new BehaviorSubject<Channel[]>([]);
export const activeChannel$ = new BehaviorSubject<Channel | null>(null);
export const currentEpgProgram$ = new BehaviorSubject<EpgProgram | null>(null);
export const epgPrograms$ = new BehaviorSubject<EpgProgram[]>([]);
export const epgServiceMock = {
    currentEpgPrograms$: epgPrograms$.asObservable(),
    getChannelMetadataForChannels: () => of(new Map()),
};

export const player = signal<VideoPlayer>(VideoPlayer.VideoJs);
export const showCaptions = signal(false);
export const stripCountryPrefix = signal(false);
export const epgViewMode = signal<'timeline' | 'list'>('timeline');
export const epgUrlSetting = signal<string[]>([]);
export const externalSession = signal<ExternalPlayerSession | null>(null);
export const storeMock = {
    dispatch: jest.fn(),
    selectSignal: jest.fn((selector: unknown) => {
        switch (selector) {
            case selectActive:
                return activeChannel;
            case selectActivePlaybackUrl:
                return activePlaybackUrl;
            case selectChannels:
                return channels;
            case selectChannelsLoading:
                return channelsLoading;
            case selectCurrentEpgProgram:
                return currentEpgProgram;
            case selectActiveEpgProgram:
                return activeEpgProgram;
            case selectFavorites:
                return favoriteIds;
            default:
                return signal(null);
        }
    }),
    select: jest.fn((selector: unknown) => {
        switch (selector) {
            case selectChannels:
                return channels$.asObservable();
            case selectActive:
                return activeChannel$.asObservable();
            case selectCurrentEpgProgram:
                return currentEpgProgram$.asObservable();
            default:
                return of(null);
        }
    }),
};

export const routerMock = {
    url: '/workspace/playlists/playlist-1/all',
    navigate: jest.fn(),
    currentNavigation: jest.fn().mockReturnValue(null),
};

export const playlistsServiceMock = {
    getPlaylist: jest.fn(() =>
        of({
            playlist: {
                items: channels(),
            },
            favorites: [],
        })
    ),
    getPlaylistWithGlobalFavorites: jest.fn(() =>
        of({
            playlist: {
                items: [],
            },
            favorites: [],
        })
    ),
    addM3uRecentlyViewed: jest.fn(() =>
        of({
            recentlyViewed: [],
        })
    ),
};
export const dataServiceMock = {
    sendIpcEvent: jest.fn(),
};

export const sampleChannel: Channel = {
    id: 'channel-1',
    url: 'http://localhost/live.m3u8',
    name: 'Sample TV',
    epgParams: '',
    radio: 'false',
    tvg: {
        id: 'sample-tvg-id',
        logo: 'http://localhost/logo.png',
        name: 'Sample TV',
    },
} as Channel;

export function syncStoreState(channel: Channel | null): void {
    activeChannel.set(channel);
    activeChannel$.next(channel);
    channels.set(channel ? [channel] : []);
    channels$.next(channel ? [channel] : []);
}

/**
 * Programme covering "now" on `channel`. The docked guide strip and the
 * recording snapshot both derive the live programme from the active channel's
 * own schedule, so their assertions need a window the clock falls inside.
 */
export function buildAiringProgram(
    title: string,
    channel = 'sample-tvg-id'
): EpgProgram {
    const startMs = Date.now() - 10 * 60_000;
    const stopMs = startMs + 60 * 60_000;
    return {
        start: new Date(startMs).toISOString(),
        stop: new Date(stopMs).toISOString(),
        channel,
        title,
        desc: null,
        category: null,
        startTimestamp: Math.floor(startMs / 1000),
        stopTimestamp: Math.floor(stopMs / 1000),
    };
}

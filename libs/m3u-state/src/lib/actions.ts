import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { Channel, EpgProgram, Playlist, PlaylistMeta } from '@iptvnator/shared/interfaces';

export const PlaylistActions = createActionGroup({
    source: 'Playlists',
    events: {
        'Load Playlists': emptyProps(),
        'Load Playlists Success': props<{ playlists: PlaylistMeta[] }>(),
        'Add Playlist': props<{ playlist: Playlist }>(),
        'Add Many Playlists': props<{ playlists: Playlist[] }>(),
        'Remove Playlist': props<{ playlistId: string }>(),
        'Update Playlist Meta': props<{ playlist: PlaylistMeta }>(),
        'Update Playlist': props<{ playlist: Playlist; playlistId: string }>(),
        'Update Many Playlists': props<{ playlists: Playlist[] }>(),
        'Parse Playlist': props<{
            uploadType: 'FILE' | 'URL' | 'TEXT';
            playlist: string;
            title: string;
            path?: string;
        }>(),
        'Set Active Playlist': props<{ playlistId: string }>(),
        'Update Playlist Positions': props<{
            positionUpdates: { id: string; changes: { position: number } }[];
        }>(),
        'Remove All Playlists': emptyProps(),
        'Handle Adding Playlist By Url': props<{
            isTemporary: boolean;
            playlist: Playlist;
        }>(),
    },
});

export const ChannelActions = createActionGroup({
    source: 'Channels',
    events: {
        'Set Channels Loading': props<{ loading: boolean }>(),
        'Set Channels': props<{ channels: Channel[] }>(),
        'Set Active Channel': props<{
            channel: Channel;
            startPlayback?: boolean;
        }>(),
        'Set Active Channel Success': props<{ channel: Channel }>(),
        'Reset Active Channel': emptyProps(),
        'Set Adjacent Channel As Active': props<{
            direction: 'next' | 'previous';
        }>(),
    },
});

export const EpgActions = createActionGroup({
    source: 'EPG',
    events: {
        'Set Active Epg Program': props<{ program: EpgProgram }>(),
        'Set Active Playback Url': props<{ playbackUrl: string }>(),
        'Set Current Epg Program': props<{ program: EpgProgram }>(),
        'Reset Active Epg Program': emptyProps(),
        'Return To Live Playback': emptyProps(),
        'Set Epg Available Flag': props<{ value: boolean }>(),
    },
});

export const FavoritesActions = createActionGroup({
    source: 'Favorites',
    events: {
        'Update Favorites': props<{ channel: Channel }>(),
        'Set Favorites': props<{ channelIds: string[] }>(),
    },
});

export const FilterActions = createActionGroup({
    source: 'Filters',
    events: {
        'Set Selected Filters': props<{ selectedFilters: string[] }>(),
    },
});

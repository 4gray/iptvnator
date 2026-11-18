import { ChannelDrm } from './channel-drm.interface';
import { PlaybackPositionData } from './playback-position.interface';

export interface PlayerContentInfo extends Omit<
    PlaybackPositionData,
    'positionSeconds' | 'durationSeconds' | 'updatedAt'
> {
    playlistId: string;
}

export interface ResolvedPortalPlayback {
    streamUrl: string;
    /** The provider must resolve a fresh URL before another playback engine opens it. */
    requiresFreshStreamUrl?: boolean;
    /** Source-owner supplied, advertised TS alternative for Xtream live Auto only. */
    liveAutoTsUrl?: string;
    title: string;
    thumbnail?: string | null;
    isLive?: boolean;
    /** Playlist entry identity, independent of expiring stream URLs. */
    catalogIdentity?: {
        playlistId: string;
        type: 'live' | 'vod';
        id: string | number;
    };
    startTime?: number;
    launchId?: string;
    contentInfo?: PlayerContentInfo;
    headers?: Record<string, string>;
    userAgent?: string;
    referer?: string;
    origin?: string;
    drm?: ChannelDrm;
}

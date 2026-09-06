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
    /** Source-owner supplied, advertised TS alternative for Xtream live Auto only. */
    liveAutoTsUrl?: string;
    title: string;
    thumbnail?: string | null;
    isLive?: boolean;
    startTime?: number;
    contentInfo?: PlayerContentInfo;
    headers?: Record<string, string>;
    userAgent?: string;
    referer?: string;
    origin?: string;
    drm?: ChannelDrm;
}

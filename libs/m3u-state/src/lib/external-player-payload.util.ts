import { Channel, VideoPlayer } from '@iptvnator/shared/interfaces';
import { isDashChannel } from '@iptvnator/shared/m3u-utils';

/**
 * Decides whether activating a channel should auto-launch the configured
 * external player. Radio channels use the inline audio player; DASH (`.mpd`)
 * channels use the inline Shaka engine because MPV/VLC cannot receive the
 * KODIPROP ClearKey configuration.
 */
export function shouldAutoLaunchExternalPlayer(
    settings:
        | { player?: VideoPlayer; openStreamOnDoubleClick?: boolean }
        | null
        | undefined,
    startPlayback: boolean | undefined,
    channel: Channel,
    player: VideoPlayer.MPV | VideoPlayer.VLC
): boolean {
    if (!settings || Object.keys(settings).length === 0) {
        return false;
    }

    const startRequested =
        !settings.openStreamOnDoubleClick || startPlayback === true;
    return (
        startRequested &&
        settings.player === player &&
        channel.radio !== 'true' &&
        !isDashChannel(channel)
    );
}

export function buildExternalPlayerPayload(
    activeChannel: Channel | undefined | null,
    playbackUrl: string
):
    | {
          url: string;
          title: string;
          'user-agent': string | undefined;
          referer: string | undefined;
          origin: string | undefined;
      }
    | null {
    if (!playbackUrl || !activeChannel) {
        return null;
    }

    return {
        url: playbackUrl,
        title: activeChannel.name ?? '',
        'user-agent': activeChannel.http?.['user-agent'],
        referer: activeChannel.http?.referrer,
        origin: activeChannel.http?.origin,
    };
}

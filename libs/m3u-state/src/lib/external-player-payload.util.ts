import { Channel } from '@iptvnator/shared/interfaces';

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

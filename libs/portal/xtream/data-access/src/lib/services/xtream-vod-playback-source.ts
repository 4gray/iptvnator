import { XtreamVodDetails } from '@iptvnator/shared/interfaces';

export type XtreamVodPlaybackItem = XtreamVodDetails & {
    readonly stream_id?: number | string | null;
    readonly container_extension?: string | null;
};

export interface XtreamVodPlaybackSource {
    readonly streamId: number;
    readonly containerExtension: string;
}

function resolveCandidate(
    streamIdValue: unknown,
    containerExtensionValue: unknown
): XtreamVodPlaybackSource | null {
    const streamId =
        typeof streamIdValue === 'string' && streamIdValue.trim()
            ? Number(streamIdValue)
            : streamIdValue;
    const containerExtension =
        typeof containerExtensionValue === 'string'
            ? containerExtensionValue.trim()
            : '';

    if (
        typeof streamId !== 'number' ||
        !Number.isSafeInteger(streamId) ||
        streamId <= 0 ||
        !containerExtension
    ) {
        return null;
    }

    return { streamId, containerExtension };
}

export function resolveXtreamVodPlaybackSource(
    item: XtreamVodPlaybackItem | null | undefined
): XtreamVodPlaybackSource | null {
    if (!item) {
        return null;
    }

    return (
        resolveCandidate(
            item.movie_data?.stream_id,
            item.movie_data?.container_extension
        ) ?? resolveCandidate(item.stream_id, item.container_extension)
    );
}

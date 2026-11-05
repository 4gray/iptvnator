import { XtreamVodDetails } from '@iptvnator/shared/interfaces';

export type XtreamVodPlaybackItem = XtreamVodDetails & {
    readonly stream_id?: number | string | null;
    readonly container_extension?: string | null;
    readonly direct_source?: string | null;
};

export interface XtreamVodPlaybackSource {
    readonly streamId: number;
    readonly containerExtension: string;
    readonly directSource?: string;
}

function resolveDirectSource(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    try {
        const url = new URL(value.trim());
        return ['http:', 'https:'].includes(url.protocol)
            ? value.trim()
            : undefined;
    } catch {
        return undefined;
    }
}

function resolveCandidate(
    item:
        | Pick<
              XtreamVodPlaybackItem,
              'stream_id' | 'container_extension' | 'direct_source'
          >
        | null
        | undefined
): XtreamVodPlaybackSource | null {
    const streamIdValue = item?.stream_id;
    const containerExtensionValue = item?.container_extension;
    const streamId =
        typeof streamIdValue === 'string' && streamIdValue.trim()
            ? Number(streamIdValue)
            : streamIdValue;
    const containerExtension =
        typeof containerExtensionValue === 'string'
            ? containerExtensionValue.trim()
            : '';
    const directSource = resolveDirectSource(item?.direct_source);

    if (
        typeof streamId !== 'number' ||
        !Number.isSafeInteger(streamId) ||
        streamId <= 0 ||
        (!containerExtension && !directSource)
    ) {
        return null;
    }

    return {
        streamId,
        containerExtension,
        ...(directSource ? { directSource } : {}),
    };
}

export function resolveXtreamVodPlaybackSource(
    item: XtreamVodPlaybackItem | null | undefined
): XtreamVodPlaybackSource | null {
    if (!item) {
        return null;
    }

    return resolveCandidate(item.movie_data) ?? resolveCandidate(item);
}

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
    streamIdValue: unknown,
    containerExtensionValue: unknown,
    directSourceValue: unknown
): XtreamVodPlaybackSource | null {
    const streamId =
        typeof streamIdValue === 'string' && streamIdValue.trim()
            ? Number(streamIdValue)
            : streamIdValue;
    const containerExtension =
        typeof containerExtensionValue === 'string'
            ? containerExtensionValue.trim()
            : '';
    const directSource = resolveDirectSource(directSourceValue);

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

    return (
        resolveCandidate(
            item.movie_data?.stream_id,
            item.movie_data?.container_extension,
            item.movie_data?.direct_source
        ) ??
        resolveCandidate(
            item.stream_id,
            item.container_extension,
            item.direct_source
        )
    );
}

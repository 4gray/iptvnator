import {
    getXtreamVodInfo,
    XtreamVodDetails,
} from '@iptvnator/shared/interfaces';

type XtreamVodPresentationItem = XtreamVodDetails & {
    readonly name?: string;
    readonly poster_url?: string;
    readonly stream_icon?: string;
    readonly title?: string;
};

export interface XtreamVodPlaybackPresentation {
    readonly posterUrl?: string;
    readonly title: string;
}

export function resolveXtreamVodPlaybackPresentation(
    vodItem: XtreamVodDetails
): XtreamVodPlaybackPresentation {
    const item = vodItem as XtreamVodPresentationItem;
    const info = getXtreamVodInfo(vodItem);

    return {
        title:
            firstText(
                info?.name,
                item.movie_data?.name,
                item.title,
                item.name
            ) ?? 'Unknown',
        posterUrl: firstText(
            info?.movie_image,
            info?.cover_big,
            item.poster_url,
            item.stream_icon
        ),
    };
}

function firstText(...values: unknown[]): string | undefined {
    const value = values.find(
        (candidate) =>
            typeof candidate === 'string' && candidate.trim().length > 0
    );
    return typeof value === 'string' ? value.trim() : undefined;
}

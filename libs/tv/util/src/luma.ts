import type { Media, UserData } from './index';
import { continueWatching } from './continue-watching';
import { mediaTitle, seriesForEpisode } from './series-context';

export interface LumaCard {
    id: string;
    sourceId: string;
    kind: Media['kind'];
    title: string;
    poster?: string;
    seconds?: number;
    duration?: number;
}
/** Deliberately excludes raw provider data, source credentials and playback URLs. */
export function lumaFeed(data: UserData, now = Date.now()) {
    const card = (item: Media): LumaCard => {
        const parent = seriesForEpisode(item, data.favorites);
        const poster = parent?.poster ?? item.poster;
        return {
            id: item.id,
            sourceId: item.sourceId,
            kind: item.kind === 'episode' ? 'series' : item.kind,
            title: (parent?.title ?? mediaTitle(item)).slice(0, 240),
            // Provider artwork can carry account credentials. Export only public TMDB images.
            poster: /^https:\/\/image\.tmdb\.org\/t\/p\/[a-zA-Z0-9/_.-]+$/.test(
                poster ?? ''
            )
                ? poster
                : undefined,
        };
    };
    const sources = new Set(data.sources.map((s) => s.id));
    return {
        version: 1,
        updatedAt: now,
        recent: continueWatching(data, 5).map((p) => ({
            ...card(p.item),
            seconds: p.seconds,
            duration: p.duration,
        })),
        favorites: data.favorites
            .filter((m) => sources.has(m.sourceId))
            .slice(0, 5)
            .map(card),
    };
}

export function lumaSelection(
    data: UserData,
    value: unknown
): Media | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const request = value as Record<string, unknown>;
    if (
        request.action !== 'open' ||
        typeof request.id !== 'string' ||
        typeof request.sourceId !== 'string' ||
        request.id.length > 2048
    )
        return undefined;
    if (!data.sources.some((s) => s.id === request.sourceId)) return undefined;
    const saved = [...data.favorites, ...data.history.map((p) => p.item)].find(
        (m) => m.id === request.id && m.sourceId === request.sourceId
    );
    return saved
        ? (seriesForEpisode(saved, data.favorites) ?? saved)
        : undefined;
}

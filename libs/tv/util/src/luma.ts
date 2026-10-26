import type { Media, Source, UserData } from './index';
import { lumaId, savedLumaItems } from './luma-identities';
import { continueWatching } from './continue-watching';
import { mediaTitle, seriesForEpisode } from './series-context';

export interface LumaCard {
    id: string;
    sourceId: string;
    kind: Media['kind'];
    title: string;
    year?: string;
    season?: number;
    episode?: number;
    poster?: string;
    seconds?: number;
    duration?: number;
}
/** Deliberately excludes raw provider data, source credentials and playback URLs. */
export function lumaArtwork(
    value: string | undefined,
    source?: Source
): string | undefined {
    try {
        const url = new URL(value ?? '');
        if (
            !/^https?:$/.test(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            !/\.(png|jpe?g|webp)$/i.test(url.pathname)
        )
            return undefined;
        const path = decodeURIComponent(url.pathname);
        const credentials = source
            ? [
                  source.username,
                  source.password,
                  source.macAddress,
                  source.token,
                  source.serialNumber,
                  source.deviceId1,
                  source.deviceId2,
                  source.signature1,
                  source.signature2,
              ]
            : [];
        if (
            credentials.some(
                (secret) =>
                    secret &&
                    (secret.length >= 4
                        ? path.includes(secret)
                        : path.split('/').includes(secret))
            )
        )
            return undefined;
        return url.href;
    } catch {
        return undefined;
    }
}
export function lumaFeed(
    data: UserData,
    now = Date.now(),
    resolvePoster: (item: Media) => string | undefined = (item) => item.poster
) {
    const card = (item: Media): LumaCard => {
        const parent = seriesForEpisode(item, data.favorites);
        const display = parent ?? item;
        return {
            id: lumaId(data, item)!,
            sourceId: item.sourceId,
            kind: item.kind === 'episode' ? 'series' : item.kind,
            title: (parent?.title ?? mediaTitle(item)).slice(0, 240),
            year: /^\d{4}$/.test(display.year ?? '') ? display.year : undefined,
            season:
                Number.isInteger(item.season) && item.season! > 0
                    ? item.season
                    : undefined,
            episode:
                Number.isInteger(item.episode) && item.episode! > 0
                    ? item.episode
                    : undefined,
            poster:
                lumaArtwork(
                    resolvePoster(display),
                    data.sources.find((s) => s.id === item.sourceId)
                ) ??
                lumaArtwork(
                    resolvePoster(item),
                    data.sources.find((s) => s.id === item.sourceId)
                ),
        };
    };
    const sources = new Set(data.sources.map((s) => s.id));
    return {
        version: 1,
        updatedAt: now,
        recent: continueWatching(data, 5)
            .filter((p) => lumaId(data, p.item))
            .map((p) => ({
                ...card(p.item),
                seconds: p.seconds,
                duration: p.duration,
            })),
        favorites: data.favorites
            .filter((m) => sources.has(m.sourceId) && lumaId(data, m))
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
    const saved = savedLumaItems(data).find(
        (m) =>
            (lumaId(data, m) === request.id || m.id === request.id) &&
            m.sourceId === request.sourceId
    );
    return saved
        ? (seriesForEpisode(saved, data.favorites) ?? saved)
        : undefined;
}

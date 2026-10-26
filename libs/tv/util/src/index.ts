import {
    CatalogSort,
    CatalogSortPreferences,
    normalizeCatalogSort,
} from './catalog-sort';
export type Kind = 'live' | 'movie' | 'series' | 'episode';
export type Provider = 'xtream' | 'stalker' | 'm3u';
export interface Source {
    id: string;
    name: string;
    provider: Provider;
    url: string;
    username?: string;
    password?: string;
    macAddress?: string;
    serialNumber?: string;
    deviceId1?: string;
    deviceId2?: string;
    signature1?: string;
    signature2?: string;
    endpoint?: string;
    full?: boolean;
    token?: string;
    userAgent?: string;
    referrer?: string;
    origin?: string;
    m3uItems?: Record<string, unknown>[];
    libraryId?: string;
}
export interface Media {
    id: string;
    sourceId: string;
    providerId: string;
    kind: Kind;
    title: string;
    addedAt?: number;
    poster?: string;
    /** Episode landscape still, independent of its series cover. */
    episodeStill?: string;
    backdrop?: string;
    description?: string;
    category?: string;
    year?: string;
    season?: number;
    episode?: number;
    parentId?: string;
    /** Parent editorial context is independent of episode identity and playback. */
    seriesTitle?: string;
    seriesYear?: string;
    /** Exact parent for Home details; excludes cached episode lists. */
    parentSeries?: Media;
    metadata?: {
        tmdbId: number;
        cast: {
            name: string;
            character?: string;
            profileUrl: string | null;
            tmdbPersonId?: number;
        }[];
        authors: {
            name: string;
            profileUrl: string | null;
            tmdbPersonId?: number;
        }[];
        authorRole: 'Creators' | 'Directors';
    };
    raw: Record<string, unknown>;
}
export interface Category {
    id: string;
    name: string;
}
export interface Catalog {
    items: Media[];
    total: number;
    page: number;
    pageSize?: number;
    categories: Category[];
}
export interface Program {
    title: string;
    description?: string;
    start: number;
    end: number;
}
export interface Playback {
    url: string;
    requiresHeaders?: boolean;
}
export interface ProviderClient {
    readonly capabilities: {
        live: boolean;
        movies: boolean;
        series: boolean;
        /** Stalker may also expose series inside its VOD catalog. */
        vodSeries?: boolean;
        epg: boolean;
    };
    connect(signal: AbortSignal): Promise<Source>;
    catalog(
        kind: Kind,
        category: string,
        page: number,
        query: string,
        signal: AbortSignal,
        sort?: CatalogSort
    ): Promise<Catalog>;
    details(item: Media, signal: AbortSignal): Promise<Media>;
    episodes(item: Media, signal: AbortSignal): Promise<Media[]>;
    epg(item: Media, signal: AbortSignal): Promise<Program[]>;
    resolve(item: Media, signal: AbortSignal): Promise<Playback>;
    dispose(): void;
}
export interface Progress {
    item: Media;
    seconds: number;
    duration: number;
    updated: number;
}
export interface LibrarySettings {
    url: string;
    token: string;
    instanceId: string;
    lastSync: number;
    /** Original local sources survive linking, server deletion and disconnect. */
    originals: Record<string, Source>;
}
export interface UserData {
    library?: LibrarySettings;
    sources: Source[];
    activeId: string;
    backend: string;
    backendToken: string;
    favorites: Media[];
    history: Progress[];
    positions: Record<string, Progress>;
    catalogSort: CatalogSortPreferences;
    layout: 'cinema' | 'shelf';
    epg: boolean;
    tmdb: { enabled: boolean; apiKey: string; language: string };
}
export const initialData = (): UserData => ({
    sources: [],
    activeId: '',
    backend: '',
    backendToken: '',
    favorites: [],
    history: [],
    positions: {},
    catalogSort: { movie: 'recent', series: 'recent' },
    layout: 'cinema',
    epg: true,
    tmdb: { enabled: false, apiKey: '', language: 'en' },
});
export const identity = (source: Source, kind: Kind, id: unknown) =>
    JSON.stringify([source.id, source.provider, kind, String(id)]);
export function httpUrl(value: string): string {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
        throw new Error(
            'Enter an HTTP or HTTPS URL without embedded login credentials.'
        );
    return url.href;
}
export function artwork(value: unknown): string | undefined {
    try {
        return typeof value === 'string' ? httpUrl(value) : undefined;
    } catch {
        return undefined;
    }
}
export function rows(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value)
        ? value.filter((v) => v && typeof v === 'object')
        : [];
}
export const text = (value: unknown) => (value == null ? '' : String(value));
/** Owns a single lane. Superseded requests cannot publish even if transport ignores abort. */
export class LatestRequest {
    private current?: AbortController;
    /** Read-only identity of the current request, cleared on cancellation. */
    get signal() {
        return this.current?.signal;
    }
    start() {
        this.current?.abort();
        return (this.current = new AbortController());
    }
    owns(controller: AbortController) {
        return this.current === controller && !controller.signal.aborted;
    }
    cancel() {
        this.current?.abort();
        this.current = undefined;
    }
}

/** Recent history is bounded; unfinished playback positions are retained independently. */
export function recordProgress(data: UserData, progress: Progress): UserData {
    return {
        ...data,
        history: [
            progress,
            ...data.history.filter((h) => h.item.id !== progress.item.id),
        ].slice(0, 200),
        positions: { ...data.positions, [progress.item.id]: progress },
    };
}
export function hydrateUserData(saved: Partial<UserData>): UserData {
    const data = { ...initialData(), ...saved };
    data.catalogSort = {
        movie: normalizeCatalogSort(saved.catalogSort?.movie),
        series: normalizeCatalogSort(saved.catalogSort?.series),
    };
    data.tmdb = { ...initialData().tmdb, ...saved.tmdb };
    if (!saved.positions) {
        data.positions = {};
        data.history.forEach((progress) => {
            data.positions[progress.item.id] = progress;
        });
    }
    return data;
}
export function removeSourceData(data: UserData, sourceId: string): UserData {
    const positions = { ...data.positions };
    Object.keys(positions).forEach((key) => {
        if (positions[key].item.sourceId === sourceId) delete positions[key];
    });
    return {
        ...data,
        positions,
        sources: data.sources.filter((s) => s.id !== sourceId),
        activeId: data.activeId === sourceId ? '' : data.activeId,
        favorites: data.favorites.filter((m) => m.sourceId !== sourceId),
        history: data.history.filter((h) => h.item.sourceId !== sourceId),
    };
}
export { parseSourceDraft, type SourceDraft } from './source-draft';
export * from './settings-draft';

export * from './catalog-sort';
export * from './catalog-query';
export { continueWatching } from './continue-watching';
export * from './series-context';
export * from './programme-guide';

export * from './grid-guide';

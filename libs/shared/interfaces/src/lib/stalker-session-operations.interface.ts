export const STALKER_SESSION_APPLICATION_OPERATIONS = {
    CatalogCategories: 'get-categories',
    CatalogGenres: 'get-genres',
    CatalogItems: 'get-ordered-list',
    CatalogAllChannels: 'get-all-channels',
    CatalogSearch: 'search',
    SeriesSeasons: 'get-series-seasons',
    SeriesEpisodes: 'get-series-episodes',
    ShortEpg: 'get-short-epg',
    EpgInfo: 'get-epg-info',
    CreateLink: 'create-link',
    Favorites: 'favorites',
    MainInfo: 'get-main-info',
} as const;

export type StalkerSessionApplicationOperation =
    (typeof STALKER_SESSION_APPLICATION_OPERATIONS)[keyof typeof STALKER_SESSION_APPLICATION_OPERATIONS];

export const STALKER_SESSION_CONTENT_TYPES = {
    Itv: 'itv',
    Radio: 'radio',
    Series: 'series',
    Vod: 'vod',
} as const;

export type StalkerSessionContentType =
    (typeof STALKER_SESSION_CONTENT_TYPES)[keyof typeof STALKER_SESSION_CONTENT_TYPES];

export type StalkerSessionEntityId = string | number;
export type StalkerPlaybackContextRef = string;
export type StalkerSessionNoParameters = Readonly<Record<string, never>>;

export interface StalkerSessionCategoryParameters {
    contentType: 'radio' | 'series' | 'vod';
}

export type StalkerSessionGenreParameters = StalkerSessionNoParameters;

export interface StalkerSessionCatalogParameters {
    contentType?: StalkerSessionContentType;
    category?: StalkerSessionEntityId;
    genre?: StalkerSessionEntityId;
    page?: number;
    query?: string;
    sortBy?: string;
    itemId?: StalkerSessionEntityId;
    seasonId?: StalkerSessionEntityId;
}

export type StalkerSessionAllChannelsParameters = StalkerSessionNoParameters;

export interface StalkerSessionSearchParameters {
    contentType: StalkerSessionContentType;
    query: string;
    category?: StalkerSessionEntityId;
    page?: number;
}

export interface StalkerSessionSeriesSeasonsParameters {
    seriesId: StalkerSessionEntityId;
}

export interface StalkerSessionSeriesEpisodesParameters {
    seriesId: StalkerSessionEntityId;
    seasonId: StalkerSessionEntityId;
}

export interface StalkerSessionShortEpgParameters {
    channelId: StalkerSessionEntityId;
    limit?: number;
}

export interface StalkerSessionEpgInfoParameters {
    fromTimestamp?: number;
    periodHours?: number;
    toTimestamp?: number;
}

export interface StalkerSessionCreateLinkParameters {
    contentType: StalkerSessionContentType | 'episode';
    command: string;
    itemId?: StalkerSessionEntityId;
    seriesId?: StalkerSessionEntityId;
    seasonNumber?: number;
    episodeNumber?: number;
}

export interface StalkerSessionFavoritesParameters {
    contentType: StalkerSessionContentType;
    itemId: StalkerSessionEntityId;
    favorite: boolean;
}

export type StalkerSessionMainInfoParameters = StalkerSessionNoParameters;

export interface StalkerSessionCategory {
    id: StalkerSessionEntityId;
    name: string;
    alias?: string;
    censored?: boolean;
    parentId?: StalkerSessionEntityId;
}

export interface StalkerSessionCatalogInfo {
    actors?: string;
    description?: string;
    director?: string;
    genre?: string;
    movieImage?: string;
    name?: string;
    originalName?: string;
    releaseDate?: string;
    ratingImdb?: string;
    ratingKinopoisk?: string;
}

export interface StalkerSessionCatalogItem {
    id: StalkerSessionEntityId;
    contentType: StalkerSessionContentType;
    actors?: string;
    name?: string;
    title?: string;
    originalName?: string;
    description?: string;
    director?: string;
    command?: string;
    posterUrl?: string;
    logoUrl?: string;
    screenshotUrl?: string;
    categoryId?: StalkerSessionEntityId;
    genreId?: StalkerSessionEntityId;
    videoId?: StalkerSessionEntityId;
    channelNumber?: number;
    hasFiles?: boolean;
    seriesNumbers?: readonly number[];
    year?: number;
    rating?: number;
    durationSeconds?: number;
    isSeries?: boolean;
    info?: StalkerSessionCatalogInfo;
}

export interface StalkerSessionCatalogResult {
    items: readonly StalkerSessionCatalogItem[];
    page?: number;
    total?: number;
    hasMore?: boolean;
}

export interface StalkerSessionCategoriesResult {
    items: readonly StalkerSessionCategory[];
}

export interface StalkerSessionSeason {
    id: StalkerSessionEntityId;
    number: number;
    title?: string;
    command?: string;
    episodeNumbers?: readonly number[];
}

export interface StalkerSessionSeasonsResult {
    seasons: readonly StalkerSessionSeason[];
}

export interface StalkerSessionEpisode {
    id: StalkerSessionEntityId;
    seriesId: StalkerSessionEntityId;
    seasonId: StalkerSessionEntityId;
    seasonNumber: number;
    episodeNumber: number;
    title?: string;
    command?: string;
    thumbnailUrl?: string;
    description?: string;
    durationSeconds?: number;
}

export interface StalkerSessionEpisodesResult {
    episodes: readonly StalkerSessionEpisode[];
}

export interface StalkerSessionEpgProgram {
    id?: StalkerSessionEntityId;
    channelId: StalkerSessionEntityId;
    title: string;
    description?: string;
    startsAt: number;
    endsAt: number;
}

export interface StalkerSessionEpgResult {
    programs: readonly StalkerSessionEpgProgram[];
}

export interface StalkerSessionCreateLinkResult {
    streamUrl: string;
    playbackContextRef?: StalkerPlaybackContextRef;
    title?: string;
    thumbnail?: string | null;
    isLive?: boolean;
    userAgent?: string;
    referer?: string;
    origin?: string;
}

export interface StalkerSessionFavoritesResult {
    success: boolean;
    favorite: boolean;
}

export interface StalkerSessionAccountSummary {
    name?: string;
    status?: string;
    tariffPlan?: string;
    accountBalance?: string;
    expiresAt?: string;
}

export interface StalkerSessionMainInfoResult {
    account: StalkerSessionAccountSummary;
}

export interface StalkerSessionOperationContract<Parameters, Result> {
    parameters: Parameters;
    result: Result;
}

export interface StalkerSessionOperationContractMap {
    [STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories]: StalkerSessionOperationContract<
        StalkerSessionCategoryParameters,
        StalkerSessionCategoriesResult
    >;
    [STALKER_SESSION_APPLICATION_OPERATIONS.CatalogGenres]: StalkerSessionOperationContract<
        StalkerSessionGenreParameters,
        StalkerSessionCategoriesResult
    >;
    [STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems]: StalkerSessionOperationContract<
        StalkerSessionCatalogParameters,
        StalkerSessionCatalogResult
    >;
    [STALKER_SESSION_APPLICATION_OPERATIONS.CatalogAllChannels]: StalkerSessionOperationContract<
        StalkerSessionAllChannelsParameters,
        StalkerSessionCatalogResult
    >;
    [STALKER_SESSION_APPLICATION_OPERATIONS.CatalogSearch]: StalkerSessionOperationContract<
        StalkerSessionSearchParameters,
        StalkerSessionCatalogResult
    >;
    [STALKER_SESSION_APPLICATION_OPERATIONS.SeriesSeasons]: StalkerSessionOperationContract<
        StalkerSessionSeriesSeasonsParameters,
        StalkerSessionSeasonsResult
    >;
    [STALKER_SESSION_APPLICATION_OPERATIONS.SeriesEpisodes]: StalkerSessionOperationContract<
        StalkerSessionSeriesEpisodesParameters,
        StalkerSessionEpisodesResult
    >;
    [STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg]: StalkerSessionOperationContract<
        StalkerSessionShortEpgParameters,
        StalkerSessionEpgResult
    >;
    [STALKER_SESSION_APPLICATION_OPERATIONS.EpgInfo]: StalkerSessionOperationContract<
        StalkerSessionEpgInfoParameters,
        StalkerSessionEpgResult
    >;
    [STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink]: StalkerSessionOperationContract<
        StalkerSessionCreateLinkParameters,
        StalkerSessionCreateLinkResult
    >;
    [STALKER_SESSION_APPLICATION_OPERATIONS.Favorites]: StalkerSessionOperationContract<
        StalkerSessionFavoritesParameters,
        StalkerSessionFavoritesResult
    >;
    [STALKER_SESSION_APPLICATION_OPERATIONS.MainInfo]: StalkerSessionOperationContract<
        StalkerSessionMainInfoParameters,
        StalkerSessionMainInfoResult
    >;
}

export type StalkerSessionOperationParameters<
    Operation extends StalkerSessionApplicationOperation,
> = StalkerSessionOperationContractMap[Operation]['parameters'];

export type StalkerSessionOperationResult<
    Operation extends StalkerSessionApplicationOperation,
> = StalkerSessionOperationContractMap[Operation]['result'];

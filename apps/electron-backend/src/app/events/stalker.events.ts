/**
 * This module handles all Stalker portal related IPC communications
 * between the frontend and the electron backend.
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { createHash } from 'crypto';
import { ipcMain } from 'electron';
import { PortalDebugEvent, STALKER_REQUEST } from 'shared-interfaces';
import { rememberStalkerPlaybackContext } from '../services/stalker-playback-context.service';
import { emitPortalDebugEvent } from './portal-debug.events';

const LEGACY_DEFAULT_SERIAL = 'BEDACD4569BAF';
const MAG250_USER_AGENT =
    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250';
const CUSTOM_PORTAL_CATEGORY_PREFIX = 'vp:';
const CUSTOM_PORTAL_DEFAULT_LIMIT = 14;
const CUSTOM_PORTAL_ALL_ITEMS_LIMIT = 20;

type PrimitiveValue = string | number | boolean;
type NormalizedRequestParams = Record<string, string>;
type CustomPortalPrimitiveRequest = Record<string, PrimitiveValue>;

interface StalkerRequestPayload {
    url: string;
    macAddress: string;
    params?: unknown;
    query?: unknown;
    searchParams?: unknown;
    data?: unknown;
    request?: unknown;
    requestParams?: unknown;
    payload?: unknown;
    token?: string;
    serialNumber?: string;
    requestId?: string;
    customPortalKey?: string;
}

interface CustomPortalContentItem {
    id: string;
    movie_id: string;
    stream_id: string;
    cmd: string;
    title: string;
    name: string;
    o_name: string;
    screenshot_uri: string;
    logo: string;
    category_id: string;
    description?: string;
    actors?: string;
    director?: string;
    releasedate?: string;
    year?: string;
    genre?: string;
    rating_imdb?: string;
    rating_kinopoisk?: string;
    info?: {
        description?: string;
        actors?: string;
        director?: string;
        releasedate?: string;
        genre?: string;
        rating_imdb?: string;
        rating_kinopoisk?: string;
    };
    request: CustomPortalPrimitiveRequest;
    type?: string;
    is_category?: boolean;
}

interface CustomPortalCategoryItem {
    id?: unknown;
    fid?: unknown;
    title?: unknown;
    name?: unknown;
    type?: unknown;
    request?: unknown;
}

interface CustomPortalStreamItem {
    id?: unknown;
    fid?: unknown;
    title?: unknown;
    name?: unknown;
    type?: unknown;
    img?: unknown;
    image?: unknown;
    cover?: unknown;
    poster?: unknown;
    screenshot_uri?: unknown;
    logo?: unknown;
    url?: unknown;
    stream_url?: unknown;
    play_url?: unknown;
    m3u8?: unknown;
    cmd?: unknown;
    description?: unknown;
    desc?: unknown;
    plot?: unknown;
    synopsis?: unknown;
    summary?: unknown;
    actors?: unknown;
    cast?: unknown;
    director?: unknown;
    releasedate?: unknown;
    release_date?: unknown;
    year?: unknown;
    genre?: unknown;
    genres_str?: unknown;
    rating_imdb?: unknown;
    rating_kinopoisk?: unknown;
    info?: unknown;
    request?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitiveValue(value: unknown): value is PrimitiveValue {
    return (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    );
}

function getStringValue(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed) {
                return trimmed;
            }
        }
    }

    return '';
}

function getFirstDefinedValue(...values: unknown[]): unknown {
    for (const value of values) {
        if (
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ''
        ) {
            return value;
        }
    }

    return undefined;
}

function parsePositiveInteger(
    value: unknown,
    fallback?: number
): number | undefined {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
    }

    return fallback;
}

function toBase64Url(value: string): string {
    return Buffer.from(value, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const paddingLength = (4 - (normalized.length % 4)) % 4;
    const padded = `${normalized}${'='.repeat(paddingLength)}`;
    return Buffer.from(padded, 'base64').toString('utf8');
}

function encodeCustomPortalRequest(request: CustomPortalPrimitiveRequest): string {
    return `${CUSTOM_PORTAL_CATEGORY_PREFIX}${toBase64Url(JSON.stringify(request))}`;
}

function decodeCustomPortalRequest(
    value: unknown
): CustomPortalPrimitiveRequest | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith(CUSTOM_PORTAL_CATEGORY_PREFIX)) {
        return null;
    }

    try {
        const decoded = JSON.parse(
            fromBase64Url(trimmed.slice(CUSTOM_PORTAL_CATEGORY_PREFIX.length))
        );

        if (!isRecord(decoded)) {
            return null;
        }

        return sanitizeCustomPortalRequest(decoded);
    } catch {
        return null;
    }
}

function sanitizeCustomPortalRequest(
    request: unknown
): CustomPortalPrimitiveRequest {
    const sanitized: CustomPortalPrimitiveRequest = {};

    if (!isRecord(request)) {
        return sanitized;
    }

    Object.entries(request).forEach(([key, value]) => {
        if (isPrimitiveValue(value)) {
            sanitized[key] = value;
        }
    });

    return sanitized;
}


function stripCustomPortalClientMeta(
    request: CustomPortalPrimitiveRequest
): CustomPortalPrimitiveRequest {
    const normalized: CustomPortalPrimitiveRequest = {};

    Object.entries(request).forEach(([key, value]) => {
        if (key.startsWith('__')) {
            return;
        }
        normalized[key] = value;
    });

    return normalized;
}

function stripQueryFromUrl(url: string): string {
    const urlObject = new URL(url);
    return `${urlObject.origin}${urlObject.pathname}`;
}

function looksLikeCustomPortalEndpoint(url: string): boolean {
    try {
        return /\/api\/v1\/?$/i.test(new URL(url).pathname);
    } catch {
        return /\/api\/v1\/?$/i.test(url);
    }
}

function readCustomPortalKey(
    payload: StalkerRequestPayload,
    requestParams: NormalizedRequestParams
): string {
    const topLevelKey = getStringValue(payload.customPortalKey);
    if (topLevelKey) {
        return topLevelKey;
    }

    const nestedKey = getStringValue(requestParams.customPortalKey);
    if (nestedKey) {
        return nestedKey;
    }

    return '';
}

function isCustomPortalRequest(
    payload: StalkerRequestPayload,
    requestParams: NormalizedRequestParams
): boolean {
    return (
        Boolean(readCustomPortalKey(payload, requestParams)) ||
        looksLikeCustomPortalEndpoint(payload.url)
    );
}

function deriveStalkerIdentity(
    macAddress: string,
    providedSerial?: string
): { serialNumber: string; cfduid: string } {
    const normalizedMac = String(macAddress ?? '').trim().toUpperCase();
    const md5 = createHash('md5').update(normalizedMac).digest('hex');
    const derivedSerial = md5.slice(0, 13).toUpperCase();

    const normalizedProvided = String(providedSerial ?? '')
        .trim()
        .toUpperCase();

    const useProvidedSerial =
        normalizedProvided.length > 0 &&
        normalizedProvided !== LEGACY_DEFAULT_SERIAL;

    const serialNumber = useProvidedSerial ? normalizedProvided : derivedSerial;

    const serialPrefix = serialNumber.toLowerCase().replace(/[^a-f0-9]/g, '');
    const cfduid = `${serialPrefix}${md5.slice(serialPrefix.length)}`.slice(
        0,
        32
    );

    return { serialNumber, cfduid };
}

function appendParamsFromUnknown(
    target: Record<string, string>,
    source: unknown
): void {
    if (!source) {
        return;
    }

    if (source instanceof URLSearchParams) {
        source.forEach((value, key) => {
            target[key] = value;
        });
        return;
    }

    if (Array.isArray(source)) {
        source.forEach((entry) => {
            if (Array.isArray(entry) && entry.length >= 2) {
                const [key, value] = entry;
                if (value !== undefined && value !== null) {
                    target[String(key)] = String(value);
                }
            }
        });
        return;
    }

    if (!isRecord(source)) {
        return;
    }

    Object.entries(source).forEach(([key, value]) => {
        if (value === undefined || value === null) {
            return;
        }

        if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            target[key] = String(value);
            return;
        }

        if (value instanceof URLSearchParams) {
            value.forEach((nestedValue, nestedKey) => {
                target[nestedKey] = nestedValue;
            });
            return;
        }

        if (Array.isArray(value) || isRecord(value)) {
            target[key] = JSON.stringify(value);
        }
    });
}

function buildMergedRequestParams(
    url: string,
    payload: {
        params?: unknown;
        query?: unknown;
        searchParams?: unknown;
        data?: unknown;
        request?: unknown;
        requestParams?: unknown;
        payload?: unknown;
    }
): Record<string, string> {
    const requestParams: Record<string, string> = {};
    const urlObject = new URL(url);

    urlObject.searchParams.forEach((value, key) => {
        requestParams[key] = value;
    });

    appendParamsFromUnknown(requestParams, payload.params);
    appendParamsFromUnknown(requestParams, payload.query);
    appendParamsFromUnknown(requestParams, payload.searchParams);
    appendParamsFromUnknown(requestParams, payload.requestParams);

    if (isRecord(payload.data)) {
        appendParamsFromUnknown(requestParams, payload.data);
        appendParamsFromUnknown(requestParams, payload.data.params);
        appendParamsFromUnknown(requestParams, payload.data.query);
    }

    if (isRecord(payload.request)) {
        appendParamsFromUnknown(requestParams, payload.request);
        appendParamsFromUnknown(requestParams, payload.request.params);
        appendParamsFromUnknown(requestParams, payload.request.query);
    }

    if (isRecord(payload.payload)) {
        appendParamsFromUnknown(requestParams, payload.payload);
        appendParamsFromUnknown(requestParams, payload.payload.params);
        appendParamsFromUnknown(requestParams, payload.payload.query);
    }

    return requestParams;
}

function buildQueryParts(requestParams: Record<string, string>): string[] {
    const queryParts: string[] = [];

    Object.entries(requestParams).forEach(([key, value]) => {
        if (key === 'cmd') {
            queryParts.push(`${key}=${String(value)}`);
        } else {
            queryParts.push(`${key}=${encodeURIComponent(String(value))}`);
        }
    });

    if (!requestParams['JsHttpRequest']) {
        queryParts.push('JsHttpRequest=1-xml');
    }

    return queryParts;
}

function extractCustomPortalItems(responseData: unknown): unknown[] {
    if (Array.isArray(responseData)) {
        return responseData;
    }

    if (!isRecord(responseData)) {
        return [];
    }

    if (Array.isArray(responseData.items)) {
        return responseData.items;
    }

    if (isRecord(responseData.js) && Array.isArray(responseData.js.items)) {
        return responseData.js.items;
    }

    if (isRecord(responseData.data) && Array.isArray(responseData.data.items)) {
        return responseData.data.items;
    }

    if (Array.isArray(responseData.data)) {
        return responseData.data;
    }

    return [];
}

function extractCustomPortalTotalItems(
    responseData: unknown,
    fallback: number
): number {
    if (!isRecord(responseData)) {
        return fallback;
    }

    const explicitTotal = getFirstDefinedValue(
        responseData.total_items,
        responseData.total,
        responseData.count,
        isRecord(responseData.data) ? responseData.data.total_items : undefined,
        isRecord(responseData.data) ? responseData.data.total : undefined,
        isRecord(responseData.meta) ? responseData.meta.total : undefined
    );

    const parsed = Number(explicitTotal);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
    }

    return fallback;
}

function normalizeCustomPortalCategoryItems(
    responseData: unknown
): Array<{
    title: string;
    request: CustomPortalPrimitiveRequest;
}> {
    return extractCustomPortalItems(responseData)
        .map((item) => {
            if (!isRecord(item)) {
                return null;
            }

            const request = sanitizeCustomPortalRequest(item.request);
            const title = getStringValue(item.title, item.name);
            if (!title || Object.keys(request).length === 0) {
                return null;
            }

            return { title, request };
        })
        .filter(
            (
                item
            ): item is {
                title: string;
                request: CustomPortalPrimitiveRequest;
            } => item !== null
        );
}

function extractCustomPortalStreamUrl(
    item: CustomPortalStreamItem,
    request: Record<string, unknown>
): string {
    return getStringValue(
        item.url,
        item.stream_url,
        item.play_url,
        item.m3u8,
        item.cmd,
        request.url,
        request.stream_url,
        request.play_url,
        request.m3u8,
        request.cmd
    );
}


function getRecordValue(record: Record<string, unknown>, key: string): unknown {
    return key in record ? record[key] : undefined;
}

function extractCustomPortalMetaString(
    item: CustomPortalStreamItem,
    request: Record<string, unknown>,
    keys: string[]
): string {
    const info = isRecord(item.info) ? item.info : undefined;

    const values: unknown[] = [];
    for (const key of keys) {
        values.push((item as Record<string, unknown>)[key]);
        values.push(getRecordValue(request, key));
        if (info) {
            values.push(getRecordValue(info, key));
        }
    }

    return getStringValue(...values);
}

function normalizeCustomPortalContentItems(
    responseData: unknown,
    fallbackCategoryId: string,
    fallbackImage?: string
): CustomPortalContentItem[] {
    const normalizedItems: CustomPortalContentItem[] = [];

    extractCustomPortalItems(responseData).forEach((rawItem, index) => {
        if (!isRecord(rawItem)) {
            return;
        }

        const item = rawItem as CustomPortalStreamItem;
        const request = isRecord(item.request) ? item.request : {};
        const normalizedRequest = sanitizeCustomPortalRequest(request);
        const title = getStringValue(item.title, item.name);
        const image = getStringValue(
            item.img,
            item.image,
            item.cover,
            item.poster,
            item.screenshot_uri,
            item.logo,
            fallbackImage
        );
        const directUrl = extractCustomPortalStreamUrl(item, request);
        const rawType = getStringValue(item.type, request.type).toLowerCase();
        const description = extractCustomPortalMetaString(item, request, [
            'description',
            'desc',
            'plot',
            'synopsis',
            'summary',
        ]);
        const actors = extractCustomPortalMetaString(item, request, [
            'actors',
            'cast',
        ]);
        const director = extractCustomPortalMetaString(item, request, [
            'director',
        ]);
        const releasedate = extractCustomPortalMetaString(item, request, [
            'releasedate',
            'release_date',
            'year',
        ]);
        const genre = extractCustomPortalMetaString(item, request, [
            'genre',
            'genres_str',
        ]);
        const ratingImdb = extractCustomPortalMetaString(item, request, [
            'rating_imdb',
        ]);
        const ratingKinopoisk = extractCustomPortalMetaString(item, request, [
            'rating_kinopoisk',
        ]);
        const isPlayableStream =
            rawType === 'stream' ||
            directUrl.includes('.m3u8') ||
            directUrl.startsWith('http://') ||
            directUrl.startsWith('https://');
        const rawId = getFirstDefinedValue(
            item.id,
            item.fid,
            normalizedRequest.fid,
            normalizedRequest.id,
            isPlayableStream ? directUrl : undefined,
            `${fallbackCategoryId}-${index}`
        );
        const normalizedId = String(rawId);

        normalizedItems.push({
            id: normalizedId,
            movie_id: normalizedId,
            stream_id: normalizedId,
            cmd: isPlayableStream ? directUrl : '',
            title,
            name: title,
            o_name: title,
            screenshot_uri: image,
            logo: image,
            category_id: fallbackCategoryId,
            description: description || undefined,
            actors: actors || undefined,
            director: director || undefined,
            releasedate: releasedate || undefined,
            year: releasedate || undefined,
            genre: genre || undefined,
            rating_imdb: ratingImdb || undefined,
            rating_kinopoisk: ratingKinopoisk || undefined,
            info:
                description || actors || director || releasedate || genre || ratingImdb || ratingKinopoisk
                    ? {
                        description: description || undefined,
                        actors: actors || undefined,
                        director: director || undefined,
                        releasedate: releasedate || undefined,
                        genre: genre || undefined,
                        rating_imdb: ratingImdb || undefined,
                        rating_kinopoisk: ratingKinopoisk || undefined,
                    }
                    : undefined,
            request: normalizedRequest,
            type: rawType || undefined,
            is_category: !isPlayableStream,
        });
    });

    return normalizedItems;
}

function buildCustomPortalRequestFromParams(
    requestParams: NormalizedRequestParams
): CustomPortalPrimitiveRequest | null {
    const decodedCategoryRequest = decodeCustomPortalRequest(
        requestParams.category
    );
    if (decodedCategoryRequest) {
        return decodedCategoryRequest;
    }

    const decodedGenreRequest = decodeCustomPortalRequest(requestParams.genre);
    if (decodedGenreRequest) {
        return decodedGenreRequest;
    }

    if (typeof requestParams.request === 'string') {
        try {
            const parsed = JSON.parse(requestParams.request);
            const sanitized = sanitizeCustomPortalRequest(parsed);
            if (Object.keys(sanitized).length > 0) {
                return sanitized;
            }
        } catch {
            // ignore malformed request payload
        }
    }

    const directRequest = sanitizeCustomPortalRequest({
        fid: requestParams.fid,
        cmd: requestParams.cmd,
        offset: requestParams.offset,
        limit: requestParams.limit,
    });

    if (Object.keys(directRequest).length > 0) {
        return directRequest;
    }

    if (requestParams.category && requestParams.category !== '*') {
        return sanitizeCustomPortalRequest({ fid: requestParams.category });
    }

    return null;
}

function applyCustomPortalPaging(
    request: CustomPortalPrimitiveRequest,
    requestParams: NormalizedRequestParams
): CustomPortalPrimitiveRequest {
    const pageIndex = parsePositiveInteger(requestParams.p, 1) ?? 1;
    const limit =
        parsePositiveInteger(request.limit, undefined) ??
        parsePositiveInteger(requestParams.limit, undefined) ??
        CUSTOM_PORTAL_DEFAULT_LIMIT;
    const baseOffset = parsePositiveInteger(request.offset, 0) ?? 0;

    return {
        ...request,
        offset: baseOffset + (pageIndex - 1) * limit,
        limit,
    };
}

function buildCustomPortalJsonHeaders(
    baseHeaders: Record<string, string>
): Record<string, string> {
    return {
        ...baseHeaders,
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json, text/plain, */*',
    };
}

async function runCustomPortalPost(
    endpointUrl: string,
    bodies: Array<Record<string, unknown>>,
    headers: Record<string, string>,
    timeout: number,
    validateStatus: (status: number) => boolean,
    performRequest: (
        config: AxiosRequestConfig,
        requestMeta: Record<string, unknown>
    ) => Promise<AxiosResponse<any>>
): Promise<AxiosResponse<any>> {
    let lastResponse: AxiosResponse<any> | undefined;
    let lastError: unknown;

    for (const body of bodies) {
        try {
            const response = await performRequest(
                {
                    method: 'POST',
                    url: endpointUrl,
                    headers,
                    data: body,
                    timeout,
                    validateStatus,
                },
                {
                    method: 'POST',
                    url: endpointUrl,
                    headers,
                    data: body,
                    timeout,
                    mode: 'custom-videoportal',
                }
            );

            if (response.status < 400) {
                return response;
            }

            lastResponse = response;
        } catch (error) {
            lastError = error;
        }
    }

    if (lastResponse) {
        throw {
            message: `HTTP Error: ${lastResponse.statusText}`,
            status: lastResponse.status,
        };
    }

    throw (
        lastError ?? {
            message: 'Failed to fetch data from custom portal',
            status: 500,
        }
    );
}

async function fetchCustomPortalCategories(
    endpointUrl: string,
    customPortalKey: string,
    headers: Record<string, string>,
    timeout: number,
    validateStatus: (status: number) => boolean,
    performRequest: (
        config: AxiosRequestConfig,
        requestMeta: Record<string, unknown>
    ) => Promise<AxiosResponse<any>>
): Promise<AxiosResponse<any>> {
    return runCustomPortalPost(
        endpointUrl,
        [{ key: customPortalKey }],
        headers,
        timeout,
        validateStatus,
        performRequest
    );
}

async function fetchCustomPortalContent(
    endpointUrl: string,
    customPortalKey: string,
    categoryRequest: CustomPortalPrimitiveRequest,
    headers: Record<string, string>,
    timeout: number,
    validateStatus: (status: number) => boolean,
    performRequest: (
        config: AxiosRequestConfig,
        requestMeta: Record<string, unknown>
    ) => Promise<AxiosResponse<any>>
): Promise<AxiosResponse<any>> {
    const apiRequest = stripCustomPortalClientMeta(categoryRequest);

    return runCustomPortalPost(
        endpointUrl,
        [
            { key: customPortalKey, ...apiRequest },
            { key: customPortalKey, request: apiRequest },
        ],
        headers,
        timeout,
        validateStatus,
        performRequest
    );
}

async function handleCustomPortalTransport(
    payload: StalkerRequestPayload,
    requestParams: NormalizedRequestParams,
    baseHeaders: Record<string, string>,
    requestTimeout: number,
    validateStatus: (status: number) => boolean,
    performRequest: (
        config: AxiosRequestConfig,
        requestMeta: Record<string, unknown>
    ) => Promise<AxiosResponse<any>>
): Promise<any> {
    const endpointUrl = stripQueryFromUrl(payload.url);
    const customPortalKey = readCustomPortalKey(payload, requestParams);

    if (!customPortalKey) {
        throw {
            message: 'Missing custom portal key',
            status: 400,
        };
    }

    const headers = buildCustomPortalJsonHeaders(baseHeaders);
    const action = requestParams.action;

    if (action === 'create_link') {
        const directCmd = getStringValue(requestParams.cmd);
        return {
            js: {
                cmd: directCmd,
            },
        };
    }

    if (action === 'get_categories' || action === 'get_genres') {
        const categoryResponse = await fetchCustomPortalCategories(
            endpointUrl,
            customPortalKey,
            headers,
            requestTimeout,
            validateStatus,
            performRequest
        );

        const categories = normalizeCustomPortalCategoryItems(
            categoryResponse.data
        ).map((item) => {
            const encodedRequest = encodeCustomPortalRequest(item.request);
            return {
                id: encodedRequest,
                title: item.title,
                category_id: encodedRequest,
                category_name: item.title,
                request: item.request,
            };
        });

        return {
            js: categories,
        };
    }

    if (action === 'get_ordered_list') {
        const requestedCategory = String(requestParams.category ?? '').trim();

        if (requestedCategory === '*') {
            const categoriesResponse = await fetchCustomPortalCategories(
                endpointUrl,
                customPortalKey,
                headers,
                requestTimeout,
                validateStatus,
                performRequest
            );
            const categories = normalizeCustomPortalCategoryItems(
                categoriesResponse.data
            );
            const combinedItems: CustomPortalContentItem[] = [];
            const seenIds = new Set<string>();

            for (const category of categories) {
                const encodedCategoryId = encodeCustomPortalRequest(
                    category.request
                );
                const pagedRequest = applyCustomPortalPaging(
                    category.request,
                    requestParams
                );
                const response = await fetchCustomPortalContent(
                    endpointUrl,
                    customPortalKey,
                    pagedRequest,
                    headers,
                    requestTimeout,
                    validateStatus,
                    performRequest
                );
                const normalizedItems = normalizeCustomPortalContentItems(
                    response.data,
                    encodedCategoryId
                );

                normalizedItems.forEach((item) => {
                    const itemId = String(item.id ?? '');
                    if (!itemId || seenIds.has(itemId)) {
                        return;
                    }

                    seenIds.add(itemId);
                    combinedItems.push(item);
                });

                if (combinedItems.length >= CUSTOM_PORTAL_ALL_ITEMS_LIMIT) {
                    break;
                }
            }

            const items = combinedItems.slice(0, CUSTOM_PORTAL_ALL_ITEMS_LIMIT);

            return {
                js: {
                    data: items,
                    total_items: items.length,
                },
            };
        }

        const categoryRequest = buildCustomPortalRequestFromParams(requestParams);
        if (!categoryRequest) {
            return {
                js: {
                    data: [],
                    total_items: 0,
                },
            };
        }

        const pagedRequest = applyCustomPortalPaging(
            categoryRequest,
            requestParams
        );
        const contentResponse = await fetchCustomPortalContent(
            endpointUrl,
            customPortalKey,
            pagedRequest,
            headers,
            requestTimeout,
            validateStatus,
            performRequest
        );
        const categoryId =
            requestedCategory || encodeCustomPortalRequest(categoryRequest);
        const parentImage = getStringValue(categoryRequest.__parent_image);
        const items = normalizeCustomPortalContentItems(
            contentResponse.data,
            categoryId,
            parentImage
        );

        return {
            js: {
                data: items,
                total_items: extractCustomPortalTotalItems(
                    contentResponse.data,
                    items.length
                ),
            },
        };
    }

    return {
        js: {},
    };
}

export default class StalkerEvents {
    static bootstrapStalkerEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

/**
 * Handle Stalker API requests with MAC address cookie and optional Bearer token
 */
ipcMain.handle(
    STALKER_REQUEST,
    async (event, payload: StalkerRequestPayload) => {
        const startedAt = Date.now();
        let debugRequest: Record<string, unknown> | undefined;

        try {
            const { url, macAddress, token, serialNumber, requestId } = payload;

            const identity = deriveStalkerIdentity(macAddress, serialNumber);
            const effectiveSerialNumber = identity.serialNumber;
            const requestParams = buildMergedRequestParams(url, payload);

            if (
                requestParams.type === 'stb' &&
                requestParams.action === 'get_profile'
            ) {
                requestParams.sn = effectiveSerialNumber;

                if (typeof requestParams.metrics === 'string') {
                    try {
                        const parsedMetrics = JSON.parse(requestParams.metrics);
                        requestParams.metrics = JSON.stringify({
                            ...(parsedMetrics ?? {}),
                            sn: effectiveSerialNumber,
                        });
                    } catch {
                        // Keep original metrics payload when malformed.
                    }
                }
            }

            if (!requestParams.action || !requestParams.type) {
                console.warn('[StalkerEvents] Missing normalized params', {
                    payloadKeys: Object.keys(payload ?? {}),
                    normalizedParams: requestParams,
                    url,
                });
            }

            const urlObject = new URL(url);
            const queryParts = buildQueryParts(requestParams);
            const endpointUrl = `${urlObject.origin}${urlObject.pathname}`;
            const fullUrl =
                queryParts.length > 0
                    ? `${endpointUrl}?${queryParts.join('&')}`
                    : endpointUrl;
            const formBody = queryParts.join('&');

            const cookieString = `mac=${macAddress}; stb_lang=en_US@rg=dezzzz; timezone=Europe/Berlin; __cfduid=${identity.cfduid}`;

            const headers: Record<string, string> = {
                Cookie: cookieString,
                'User-Agent': MAG250_USER_AGENT,
                'X-User-Agent': MAG250_USER_AGENT,
                Accept: '*/*',
                Connection: 'keep-alive',
                'Accept-Language': 'en-US,en;q=0.9',
            };

            if (effectiveSerialNumber) {
                headers['SN'] = effectiveSerialNumber;
            }

            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const isCreateLink = requestParams.action === 'create_link';
            const requestTimeout = isCreateLink ? 30000 : 15000;
            const validateStatus = (status: number) => status < 500;

            const performRequest = async (
                config: AxiosRequestConfig,
                requestMeta: Record<string, unknown>
            ): Promise<AxiosResponse<any>> => {
                debugRequest = requestMeta;
                return axios(config);
            };

            let responseData: any;

            if (isCustomPortalRequest(payload, requestParams)) {
                responseData = await handleCustomPortalTransport(
                    payload,
                    requestParams,
                    headers,
                    requestTimeout,
                    validateStatus,
                    performRequest
                );
            } else {
                let response = await performRequest(
                    {
                        method: 'GET',
                        url: fullUrl,
                        headers,
                        timeout: requestTimeout,
                        validateStatus,
                    },
                    {
                        method: 'GET',
                        url: fullUrl,
                        headers,
                        timeout: requestTimeout,
                        params: requestParams,
                    }
                );

                if (response.status === 405) {
                    console.warn(
                        '[StalkerEvents] GET returned 405, retrying as POST',
                        {
                            action: requestParams.action,
                            type: requestParams.type,
                        }
                    );

                    const postHeaders = {
                        ...headers,
                        'Content-Type':
                            'application/x-www-form-urlencoded; charset=UTF-8',
                    };

                    response = await performRequest(
                        {
                            method: 'POST',
                            url: endpointUrl,
                            headers: postHeaders,
                            data: formBody,
                            timeout: requestTimeout,
                            validateStatus,
                        },
                        {
                            method: 'POST',
                            url: endpointUrl,
                            headers: postHeaders,
                            timeout: requestTimeout,
                            params: requestParams,
                            data: formBody,
                            fallbackFrom: 'GET',
                            originalUrl: fullUrl,
                        }
                    );

                    console.warn(
                        '[StalkerEvents] POST retry status:',
                        response.status,
                        response.statusText,
                        {
                            action: requestParams.action,
                            type: requestParams.type,
                        }
                    );
                }

                if (response.status >= 400) {
                    console.error(
                        '[StalkerEvents] HTTP Error:',
                        response.status,
                        response.statusText,
                        {
                            action: requestParams.action,
                            type: requestParams.type,
                        }
                    );

                    throw {
                        message: `HTTP Error: ${response.statusText}`,
                        status: response.status,
                    };
                }

                responseData = response.data;
            }

            if (
                requestParams.action === 'create_link' &&
                responseData?.js?.cmd &&
                typeof responseData.js.cmd === 'string'
            ) {
                rememberStalkerPlaybackContext({
                    streamUrl: responseData.js.cmd,
                    portalUrl: url,
                    macAddress,
                    serialNumber: effectiveSerialNumber,
                    token,
                });
            }

            if (requestId) {
                const debugEvent: PortalDebugEvent = {
                    requestId,
                    provider: 'stalker',
                    operation: requestParams.action ?? 'unknown',
                    transport: 'electron-main',
                    startedAt: new Date(startedAt).toISOString(),
                    durationMs: Date.now() - startedAt,
                    status: 'success',
                    request: debugRequest,
                    response: responseData,
                };

                emitPortalDebugEvent(debugEvent);
            }

            return responseData;
        } catch (error) {
            if (payload.requestId) {
                const fallbackParams = buildMergedRequestParams(
                    payload.url,
                    payload
                );

                const debugEvent: PortalDebugEvent = {
                    requestId: payload.requestId,
                    provider: 'stalker',
                    operation: fallbackParams.action ?? 'unknown',
                    transport: 'electron-main',
                    startedAt: new Date(startedAt).toISOString(),
                    durationMs: Date.now() - startedAt,
                    status: 'error',
                    request: debugRequest ?? {
                        method: 'GET',
                        url: payload.url,
                        params: fallbackParams,
                    },
                    error,
                };

                emitPortalDebugEvent(debugEvent);
            }

            console.error('[StalkerEvents] Request error:', error);

            if (axios.isAxiosError(error)) {
                const errorResponse = {
                    type: 'ERROR',
                    message:
                        error.response?.data?.message ||
                        error.message ||
                        'Failed to fetch data from Stalker portal',
                    status: error.response?.status || 500,
                };

                throw errorResponse;
            } else if (
                error &&
                typeof error === 'object' &&
                'message' in error
            ) {
                throw error;
            } else {
                throw {
                    type: 'ERROR',
                    message: 'An unknown error occurred',
                    status: 500,
                };
            }
        }
    }
);
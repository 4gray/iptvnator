/* eslint-disable max-lines -- Request parsing, listener routing, and lifecycle stay together as one auditable network boundary. */
import http, {
    IncomingHttpHeaders,
    IncomingMessage,
    Server,
    ServerResponse,
    validateHeaderName,
    validateHeaderValue,
} from 'node:http';
import { AddressInfo } from 'node:net';
import {
    REPLAY_HTTP_METHODS,
    REPLAY_MAX_REQUEST_BODY_BYTES,
} from './replay.constants.js';
import {
    createReplayRun,
    CreateReplayRunOptions,
    ReplayFinalizeResult,
    ReplayLedger,
    ReplayRun,
    ReplayRunError,
} from './replay-run.js';
import { parseReplayFixture } from './replay-schema.js';
import { createReplayRunId } from './replay-symbols.js';
import {
    ReplayFixtureV1,
    ReplayHttpMethod,
    ReplayJsonValue,
    ReplayObservedCookie,
    ReplayObservedRequest,
    ReplayObservedRequestBody,
    ReplayRenderedResponse,
} from './replay.types.js';

const REPLAY_ROUTE_ROOT = '/__iptvnator_stalker_replay__';
const LOOPBACK_ADDRESS = '127.0.0.1';
const DEFAULT_REQUEST_BODY_TIMEOUT_MS = 5000;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;

const NETWORK_ERROR_CODE = {
    INTERNAL: 'replay-internal-error',
    INVALID_BODY: 'invalid-request-body',
    INVALID_METHOD: 'invalid-request-method',
    INVALID_ROUTE: 'invalid-replay-route',
    REQUEST_BODY_TOO_LARGE: 'request-body-too-large',
    REQUEST_BODY_TIMEOUT: 'request-body-timeout',
    RESPONSE_SEND_FAILED: 'response-send-failed',
} as const;

type ReplayNetworkErrorCode =
    (typeof NETWORK_ERROR_CODE)[keyof typeof NETWORK_ERROR_CODE];

class ReplayNetworkError extends Error {
    constructor(
        readonly code: ReplayNetworkErrorCode,
        readonly status: number,
        readonly requestAlreadyCounted = false
    ) {
        super(`Replay network request rejected: ${code}.`);
        this.name = 'ReplayNetworkError';
    }
}

export type ReplayServerRunOptions = Pick<
    CreateReplayRunOptions,
    'runId' | 'now'
> & {
    requestBodyTimeoutMs?: number;
};

export interface ReplayServerRun {
    readonly runId: string;
    readonly entryUrl: string;
    readonly originUrls: Readonly<Record<string, string>>;
    readonly generatedInputs: Readonly<Record<string, string>>;
    getLedger(): ReplayLedger;
    finalize(): ReplayFinalizeResult;
    dispose(): Promise<void>;
}

interface ReplayListener {
    server: Server;
}

function sendError(
    response: ServerResponse,
    status: number,
    code: string
): void {
    if (response.destroyed) {
        return;
    }
    if (response.headersSent) {
        response.destroy();
        return;
    }
    const body = Buffer.from(JSON.stringify({ error: { code } }));
    try {
        response.writeHead(status, {
            'content-type': 'application/json',
            'content-length': String(body.byteLength),
            'cache-control': 'no-store',
            connection: 'close',
        });
        response.end(body);
    } catch {
        response.destroy();
    }
}

function statusForRunError(error: ReplayRunError): number {
    if (error.code === 'run-disposed' || error.code === 'run-expired') {
        return 410;
    }
    return 409;
}

function asHttpMethod(method: string | undefined): ReplayHttpMethod {
    if (
        method === undefined ||
        !REPLAY_HTTP_METHODS.includes(method as ReplayHttpMethod)
    ) {
        throw new ReplayNetworkError(
            NETWORK_ERROR_CODE.INVALID_METHOD,
            405
        );
    }
    return method as ReplayHttpMethod;
}

function requestPath(
    requestUrl: string | undefined,
    routePrefix: string
): { path: string; url: URL } {
    if (requestUrl === undefined) {
        throw new ReplayNetworkError(NETWORK_ERROR_CODE.INVALID_ROUTE, 404);
    }
    let url: URL;
    try {
        url = new URL(requestUrl, 'http://replay.invalid');
    } catch {
        throw new ReplayNetworkError(
            NETWORK_ERROR_CODE.INVALID_ROUTE,
            404
        );
    }
    const path =
        url.pathname === routePrefix
            ? '/'
            : url.pathname.startsWith(`${routePrefix}/`)
              ? url.pathname.slice(routePrefix.length)
              : undefined;
    if (path === undefined || path.length === 0) {
        throw new ReplayNetworkError(NETWORK_ERROR_CODE.INVALID_ROUTE, 404);
    }
    return { path, url };
}

function repeatedQuery(url: URL): Record<string, string[]> {
    const query = Object.create(null) as Record<string, string[]>;
    for (const [name, value] of url.searchParams) {
        (query[name] ??= []).push(value);
    }
    return query;
}

function repeatedHeaders(request: IncomingMessage): Record<string, string[]> {
    const headers = Object.create(null) as Record<string, string[]>;
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index]?.toLowerCase();
        const value = request.rawHeaders[index + 1];
        if (name !== undefined && value !== undefined) {
            (headers[name] ??= []).push(value);
        }
    }
    return headers;
}

function parseCookies(
    headers: IncomingHttpHeaders
): Record<string, ReplayObservedCookie> {
    const cookieHeaders = Array.isArray(headers.cookie)
        ? headers.cookie
        : headers.cookie === undefined
          ? []
          : [headers.cookie];
    const cookies = Object.create(null) as Record<
        string,
        ReplayObservedCookie
    >;
    const duplicateNames = new Set<string>();
    for (const header of cookieHeaders) {
        for (const pair of header.split(';')) {
            const separator = pair.indexOf('=');
            if (separator <= 0) {
                continue;
            }
            const name = pair.slice(0, separator).trim();
            if (name.length === 0) {
                continue;
            }
            if (duplicateNames.has(name)) {
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(cookies, name)) {
                delete cookies[name];
                duplicateNames.add(name);
                continue;
            }
            cookies[name] = {
                value: pair.slice(separator + 1).trim(),
            };
        }
    }
    return cookies;
}

function readBoundedBody(
    request: IncomingMessage,
    timeoutMs: number
): Promise<Buffer> {
    const declaredLength = request.headers['content-length'];
    if (
        declaredLength !== undefined &&
        (!/^\d+$/.test(declaredLength) ||
            Number(declaredLength) > REPLAY_MAX_REQUEST_BODY_BYTES)
    ) {
        request.resume();
        throw new ReplayNetworkError(
            NETWORK_ERROR_CODE.REQUEST_BODY_TOO_LARGE,
            413
        );
    }

    return new Promise<Buffer>((resolve, reject) => {
        let byteLength = 0;
        const chunks: Buffer[] = [];
        let settled = false;
        const cleanup = () => {
            clearTimeout(timer);
            request.off('data', onData);
            request.off('end', onEnd);
            request.off('aborted', onAborted);
            request.off('error', onError);
        };
        const rejectOnce = (error: ReplayNetworkError) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            request.resume();
            reject(error);
        };
        const onData = (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk);
            byteLength += buffer.byteLength;
            if (byteLength > REPLAY_MAX_REQUEST_BODY_BYTES) {
                rejectOnce(
                    new ReplayNetworkError(
                        NETWORK_ERROR_CODE.REQUEST_BODY_TOO_LARGE,
                        413
                    )
                );
                return;
            }
            chunks.push(buffer);
        };
        const onEnd = () => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(Buffer.concat(chunks));
        };
        const onAborted = () =>
            rejectOnce(
                new ReplayNetworkError(
                    NETWORK_ERROR_CODE.INVALID_BODY,
                    400
                )
            );
        const onError = () => onAborted();
        const timer = setTimeout(
            () =>
                rejectOnce(
                    new ReplayNetworkError(
                        NETWORK_ERROR_CODE.REQUEST_BODY_TIMEOUT,
                        408
                    )
                ),
            timeoutMs
        );
        timer.unref();
        request.on('data', onData);
        request.once('end', onEnd);
        request.once('aborted', onAborted);
        request.once('error', onError);
    });
}

function contentType(request: IncomingMessage): string {
    const header = request.headers['content-type'];
    const value = Array.isArray(header) ? header[0] : header;
    return (value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function isReplayJsonValue(value: unknown): value is ReplayJsonValue {
    const pending: Array<{ value: unknown; depth: number }> = [
        { value, depth: 0 },
    ];
    let nodes = 0;
    while (pending.length > 0) {
        const item = pending.pop();
        if (item === undefined) {
            break;
        }
        nodes += 1;
        if (nodes > MAX_JSON_NODES || item.depth > MAX_JSON_DEPTH) {
            return false;
        }
        if (
            item.value === null ||
            typeof item.value === 'string' ||
            typeof item.value === 'number' ||
            typeof item.value === 'boolean'
        ) {
            continue;
        }
        if (typeof item.value !== 'object') {
            return false;
        }
        const children = Array.isArray(item.value)
            ? item.value
            : Object.values(item.value);
        for (const child of children) {
            pending.push({ value: child, depth: item.depth + 1 });
        }
    }
    return true;
}

function parseBody(
    request: IncomingMessage,
    body: Buffer
): ReplayObservedRequestBody {
    if (body.byteLength === 0) {
        return { kind: 'absent' };
    }
    const type = contentType(request);
    const text = body.toString('utf8');
    if (type === 'application/json' || type.endsWith('+json')) {
        try {
            const value: unknown = JSON.parse(text);
            if (!isReplayJsonValue(value)) {
                throw new Error('invalid JSON value');
            }
            return { kind: 'json', value };
        } catch {
            throw new ReplayNetworkError(
                NETWORK_ERROR_CODE.INVALID_BODY,
                400
            );
        }
    }
    if (type === 'application/x-www-form-urlencoded') {
        const value = Object.create(null) as Record<string, string>;
        for (const [name, fieldValue] of new URLSearchParams(text)) {
            value[name] = fieldValue;
        }
        return { kind: 'form', value };
    }
    return { kind: 'text', value: text };
}

async function observeRequest(
    request: IncomingMessage,
    origin: string,
    routePrefix: string,
    requestBodyTimeoutMs: number
): Promise<ReplayObservedRequest> {
    const { path, url } = requestPath(request.url, routePrefix);
    const body = await readBoundedBody(request, requestBodyTimeoutMs);
    return {
        origin,
        method: asHttpMethod(request.method),
        path,
        query: repeatedQuery(url),
        headers: repeatedHeaders(request),
        cookies: parseCookies(request.headers),
        body: parseBody(request, body),
    };
}

function staysWithinRunPrefix(target: URL, originUrl: string): boolean {
    const declared = new URL(originUrl);
    return (
        target.origin === declared.origin &&
        (target.pathname === declared.pathname ||
            target.pathname.startsWith(`${declared.pathname}/`))
    );
}

function hasControlOrBackslash(value: string): boolean {
    return [...value].some((character) => {
        const code = character.charCodeAt(0);
        return character === '\\' || code <= 31 || code === 127;
    });
}

function hasParentLocationSegment(value: string): boolean {
    const pathPart = value.split(/[?#]/, 1)[0] ?? '';
    return pathPart.split('/').some((segment) => {
        try {
            return decodeURIComponent(segment).toLowerCase() === '..';
        } catch {
            return true;
        }
    });
}

function routeLocation(
    value: string,
    currentOriginUrl: string,
    requestUrl: string | undefined,
    originUrls: Readonly<Record<string, string>>
): string {
    if (
        value.trim() !== value ||
        hasControlOrBackslash(value) ||
        hasParentLocationSegment(value)
    ) {
        throw new ReplayNetworkError(
            NETWORK_ERROR_CODE.RESPONSE_SEND_FAILED,
            500,
            true
        );
    }
    try {
        const currentBase = new URL(currentOriginUrl);
        let target: URL;
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
            target = new URL(value);
        } else if (value.startsWith('//')) {
            throw new Error('scheme-relative location');
        } else if (value.startsWith('/')) {
            const relative = new URL(value, currentBase.origin);
            target = new URL(currentBase.href);
            target.pathname = `${currentBase.pathname}${relative.pathname}`;
            target.search = relative.search;
            target.hash = relative.hash;
        } else {
            const incoming = new URL(
                requestUrl ?? `${currentBase.pathname}/`,
                currentBase.origin
            );
            target = new URL(value, incoming);
        }
        if (
            !Object.values(originUrls).some((originUrl) =>
                staysWithinRunPrefix(target, originUrl)
            )
        ) {
            throw new Error('location escaped declared run origins');
        }
        return target.href;
    } catch (error) {
        if (error instanceof ReplayNetworkError) {
            throw error;
        }
        throw new ReplayNetworkError(
            NETWORK_ERROR_CODE.RESPONSE_SEND_FAILED,
            500,
            true
        );
    }
}

function routedHeaders(
    response: ReplayRenderedResponse,
    currentOriginUrl: string,
    requestUrl: string | undefined,
    originUrls: Readonly<Record<string, string>>
): Record<string, string[]> {
    return Object.fromEntries(
        Object.entries(response.headers).map(([name, values]) => [
            name,
            name === 'location'
                ? values.map((value) =>
                      routeLocation(
                          value,
                          currentOriginUrl,
                          requestUrl,
                          originUrls
                      )
                  )
                : values,
        ])
    );
}

function sendReplayResponse(
    response: ServerResponse,
    replay: ReplayRenderedResponse,
    currentOriginUrl: string,
    requestUrl: string | undefined,
    originUrls: Readonly<Record<string, string>>
): void {
    try {
        const headers = routedHeaders(
            replay,
            currentOriginUrl,
            requestUrl,
            originUrls
        );
        for (const [name, values] of Object.entries(headers)) {
            validateHeaderName(name);
            for (const value of values) {
                validateHeaderValue(name, value);
            }
        }
        response.writeHead(replay.status, headers);
        response.end(replay.body);
    } catch (error) {
        if (error instanceof ReplayNetworkError) {
            throw error;
        }
        throw new ReplayNetworkError(
            NETWORK_ERROR_CODE.RESPONSE_SEND_FAILED,
            500,
            true
        );
    }
}

async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
            server.off('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            server.off('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, LOOPBACK_ADDRESS);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Replay listener did not expose a TCP address.');
    }
    return (address as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
    if (!server.listening) {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        server.close((error) =>
            error === undefined ? resolve() : reject(error)
        );
    });
}

export async function createReplayServerRun(
    fixtureInput: ReplayFixtureV1 | unknown,
    options: ReplayServerRunOptions = {}
): Promise<ReplayServerRun> {
    const fixture = parseReplayFixture(fixtureInput);
    const runId = options.runId ?? createReplayRunId();
    const requestBodyTimeoutMs =
        options.requestBodyTimeoutMs ?? DEFAULT_REQUEST_BODY_TIMEOUT_MS;
    if (
        !Number.isInteger(requestBodyTimeoutMs) ||
        requestBodyTimeoutMs <= 0
    ) {
        throw new Error('Replay request body timeout must be positive.');
    }
    const routePrefix = `${REPLAY_ROUTE_ROOT}/${encodeURIComponent(
        runId
    )}`;
    const listeners: ReplayListener[] = [];
    const originUrls = Object.create(null) as Record<string, string>;
    const runtime: { run?: ReplayRun } = {};
    let closeListenersPromise: Promise<void> | undefined;
    const closeListeners = (): Promise<void> => {
        closeListenersPromise ??= Promise.all(
            listeners.map(({ server }) => closeServer(server))
        ).then(() => undefined);
        return closeListenersPromise;
    };

    try {
        for (const origin of Object.keys(fixture.origins)) {
            const server = http.createServer(async (request, response) => {
                try {
                    const activeRun = runtime.run;
                    if (activeRun === undefined) {
                        sendError(
                            response,
                            503,
                            NETWORK_ERROR_CODE.INTERNAL
                        );
                        return;
                    }
                    const observed = await observeRequest(
                        request,
                        origin,
                        routePrefix,
                        requestBodyTimeoutMs
                    );
                    const rendered = await activeRun.request(observed);
                    const currentOriginUrl = originUrls[origin];
                    if (currentOriginUrl === undefined) {
                        throw new Error(
                            'Replay origin listener is not registered.'
                        );
                    }
                    sendReplayResponse(
                        response,
                        rendered,
                        currentOriginUrl,
                        request.url,
                        originUrls
                    );
                } catch (error) {
                    if (error instanceof ReplayNetworkError) {
                        runtime.run?.recordNetworkFailure(
                            error.code,
                            error.requestAlreadyCounted
                        );
                        sendError(response, error.status, error.code);
                    } else if (error instanceof ReplayRunError) {
                        sendError(
                            response,
                            statusForRunError(error),
                            error.code
                        );
                    } else {
                        runtime.run?.recordNetworkFailure(
                            NETWORK_ERROR_CODE.INTERNAL
                        );
                        sendError(
                            response,
                            500,
                            NETWORK_ERROR_CODE.INTERNAL
                        );
                    }
                }
            });
            const port = await listen(server);
            listeners.push({ server });
            originUrls[
                origin
            ] = `http://${LOOPBACK_ADDRESS}:${port}${routePrefix}`;
        }
    } catch (error) {
        await Promise.all(listeners.map(({ server }) => closeServer(server)));
        throw error;
    }

    const run = createReplayRun(fixture, {
        runId,
        now: options.now,
        originUrls,
        onExpired: () => {
            void closeListeners().catch(() => undefined);
        },
    });
    runtime.run = run;

    let disposePromise: Promise<void> | undefined;
    return {
        runId: run.runId,
        entryUrl: `${originUrls[fixture.entry.origin]}${fixture.entry.path}`,
        originUrls: Object.freeze({ ...originUrls }),
        generatedInputs: run.getGeneratedInputs(),
        getLedger: () => run.getLedger(),
        finalize: () => run.finalize(),
        dispose: () => {
            disposePromise ??= (async () => {
                run.dispose();
                await closeListeners();
            })();
            return disposePromise;
        },
    };
}

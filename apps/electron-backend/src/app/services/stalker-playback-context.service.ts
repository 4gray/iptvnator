import { randomBytes } from 'node:crypto';
import {
    buildStalkerSerialCfduid,
    normalizeStalkerSerialNumber,
} from '@iptvnator/shared/interfaces';

const STALKER_MAG_USER_AGENT =
    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250';
const STALKER_STREAM_USER_AGENT = 'KSPlayer';
const STALKER_STREAM_RANGE_HEADER = 'bytes=0-';
const PLAYBACK_CONTEXT_TTL_MS = 2 * 60 * 1000;
const MAX_CONTEXTS = 4096;
const MAX_REF_LENGTH = 512;
const MAX_BINDING_LENGTH = 1024;
const MAX_URL_LENGTH = 16 * 1024;
const MAX_HEADERS = 64;
const MAX_HEADER_NAME_LENGTH = 256;
const MAX_HEADER_VALUE_LENGTH = 16 * 1024;

export interface StalkerPlaybackContextRegistration {
    readonly authGeneration: number;
    readonly coordinatorEpoch: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly leaseRef: string;
    readonly senderId: number;
    readonly sessionKey: string;
    readonly streamUrl: string;
}

export interface StalkerPlaybackContextConsumption {
    readonly contextRef: string;
    readonly senderId: number;
    readonly streamUrl: string;
}

export interface StalkerPlaybackContextServiceOptions {
    readonly createRef?: () => string;
    readonly now?: () => number;
}

interface OpaquePlaybackContext {
    readonly authGeneration: number;
    readonly coordinatorEpoch: number;
    readonly expiresAt: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly leaseRef: string;
    readonly senderId: number;
    readonly sessionKey: string;
    readonly streamUrl: string;
}

/**
 * Main-process-only, sender-bound registry for full-session playback.
 *
 * The renderer receives only the opaque key. Cookie and authorization values
 * stay in this registry and are released once to an exact player request.
 */
export class StalkerPlaybackContextService {
    readonly #contexts = new Map<string, OpaquePlaybackContext>();
    readonly #createRef: () => string;
    readonly #now: () => number;

    constructor(options: StalkerPlaybackContextServiceOptions = {}) {
        this.#createRef =
            options.createRef ?? (() => randomBytes(32).toString('base64url'));
        this.#now = options.now ?? Date.now;
    }

    get size(): number {
        this.#pruneExpired();
        return this.#contexts.size;
    }

    register(input: StalkerPlaybackContextRegistration): string {
        this.#pruneExpired();
        assertSafeInteger(input.senderId);
        assertSafeInteger(input.authGeneration);
        assertSafeInteger(input.coordinatorEpoch);
        assertBinding(input.leaseRef);
        assertBinding(input.sessionKey);
        const streamUrl = normalizeExactStreamUrl(input.streamUrl);
        const headers = copyHeaders(input.headers);

        if (this.#contexts.size >= MAX_CONTEXTS) {
            throw invalidContext();
        }

        let contextRef = '';
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const candidate = this.#createRef();
            assertBinding(candidate, MAX_REF_LENGTH);
            if (!this.#contexts.has(candidate)) {
                contextRef = candidate;
                break;
            }
        }
        if (!contextRef) {
            throw invalidContext();
        }

        this.#contexts.set(contextRef, {
            authGeneration: input.authGeneration,
            coordinatorEpoch: input.coordinatorEpoch,
            expiresAt: this.#now() + PLAYBACK_CONTEXT_TTL_MS,
            headers,
            leaseRef: input.leaseRef,
            senderId: input.senderId,
            sessionKey: input.sessionKey,
            streamUrl,
        });
        return contextRef;
    }

    consume(
        input: StalkerPlaybackContextConsumption
    ): Record<string, string> | null {
        this.#pruneExpired();
        if (
            !isSafeInteger(input.senderId) ||
            !isBinding(input.contextRef, MAX_REF_LENGTH)
        ) {
            return null;
        }
        const context = this.#contexts.get(input.contextRef);
        if (!context || context.senderId !== input.senderId) {
            return null;
        }

        let streamUrl: string;
        try {
            streamUrl = normalizeExactStreamUrl(input.streamUrl);
        } catch {
            return null;
        }
        if (context.streamUrl !== streamUrl) {
            return null;
        }

        this.#contexts.delete(input.contextRef);
        return { ...context.headers };
    }

    has(contextRef: string): boolean {
        this.#pruneExpired();
        return this.#contexts.has(contextRef);
    }

    invalidateLease(leaseRef: string): void {
        this.#deleteWhere((context) => context.leaseRef === leaseRef);
    }

    invalidateSession(sessionKey: string): void {
        this.#deleteWhere((context) => context.sessionKey === sessionKey);
    }

    invalidateAuthGeneration(sessionKey: string, authGeneration: number): void {
        this.#deleteWhere(
            (context) =>
                context.sessionKey === sessionKey &&
                context.authGeneration === authGeneration
        );
    }

    invalidateCoordinatorEpoch(
        sessionKey: string,
        coordinatorEpoch: number
    ): void {
        this.#deleteWhere(
            (context) =>
                context.sessionKey === sessionKey &&
                context.coordinatorEpoch === coordinatorEpoch
        );
    }

    cleanupSender(senderId: number): void {
        this.#deleteWhere((context) => context.senderId === senderId);
    }

    clear(): void {
        this.#contexts.clear();
    }

    #deleteWhere(predicate: (context: OpaquePlaybackContext) => boolean): void {
        for (const [contextRef, context] of this.#contexts) {
            if (predicate(context)) {
                this.#contexts.delete(contextRef);
            }
        }
    }

    #pruneExpired(): void {
        const now = this.#now();
        this.#deleteWhere((context) => context.expiresAt <= now);
    }
}

export const stalkerPlaybackContextService =
    new StalkerPlaybackContextService();

interface LegacyPlaybackContext {
    readonly createdAt: number;
    readonly headers: Readonly<Record<string, string>>;
}

const legacyPlaybackContexts = new Map<string, LegacyPlaybackContext>();

/**
 * Compatibility bridge for the legacy STALKER_REQUEST path. New full-session
 * traffic must use {@link StalkerPlaybackContextService} and an opaque ref.
 */
export function rememberStalkerPlaybackContext(input: {
    streamUrl: string;
    portalUrl: string;
    macAddress: string;
    serialNumber?: string;
    token?: string;
}): void {
    let streamUrl: string;
    try {
        streamUrl = normalizeExactStreamUrl(input.streamUrl);
    } catch {
        return;
    }
    if (!input.macAddress) {
        return;
    }

    const serialNumber = normalizeStalkerSerialNumber(input.serialNumber);
    const cookieParts = [
        `mac=${input.macAddress}`,
        'stb_lang=en_US@rg=dezzzz',
        'timezone=Europe/Berlin',
    ];
    if (serialNumber) {
        cookieParts.push(`__cfduid=${buildStalkerSerialCfduid(serialNumber)}`);
    }

    const streamOrigin = new URL(streamUrl).origin;
    let portalOrigin: string | undefined;
    try {
        portalOrigin = new URL(input.portalUrl).origin;
    } catch {
        portalOrigin = undefined;
    }
    const crossOriginStream =
        portalOrigin !== undefined && streamOrigin !== portalOrigin;
    const headers: Record<string, string> = crossOriginStream
        ? {
              Accept: '*/*',
              Connection: 'keep-alive',
              'Icy-MetaData': '1',
              Range: STALKER_STREAM_RANGE_HEADER,
              'User-Agent': STALKER_STREAM_USER_AGENT,
          }
        : {
              Cookie: cookieParts.join('; '),
              'User-Agent': STALKER_MAG_USER_AGENT,
              'X-User-Agent': STALKER_MAG_USER_AGENT,
          };

    if (!crossOriginStream && portalOrigin) {
        headers['Origin'] = portalOrigin;
        headers['Referer'] = portalOrigin;
    }
    if (!crossOriginStream && serialNumber) {
        headers['SN'] = serialNumber;
    }
    if (!crossOriginStream && input.token) {
        headers['Authorization'] = `Bearer ${input.token}`;
    }

    legacyPlaybackContexts.set(streamUrl, {
        createdAt: Date.now(),
        headers: Object.freeze({ ...headers }),
    });
    pruneLegacyContexts();
}

export function getStalkerPlaybackContextHeaders(
    streamUrl: string
): Record<string, string> | null {
    pruneLegacyContexts();
    let key: string;
    try {
        key = normalizeExactStreamUrl(streamUrl);
    } catch {
        return null;
    }
    const context = legacyPlaybackContexts.get(key);
    return context ? { ...context.headers } : null;
}

function normalizeExactStreamUrl(streamUrl: string): string {
    const trimmed = String(streamUrl ?? '').trim();
    if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
        throw invalidContext();
    }
    const separator = trimmed.indexOf(' ');
    const unwrapped =
        separator > 0 ? trimmed.slice(separator + 1).trim() : trimmed;
    const url = new URL(unwrapped);
    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username !== '' ||
        url.password !== ''
    ) {
        throw invalidContext();
    }
    url.hash = '';
    return url.toString();
}

function copyHeaders(
    headers: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
    const entries = Object.entries(headers);
    if (entries.length > MAX_HEADERS) {
        throw invalidContext();
    }
    const result: Record<string, string> = {};
    for (const [name, value] of entries) {
        if (
            !isHeaderName(name) ||
            typeof value !== 'string' ||
            value.length === 0 ||
            value.length > MAX_HEADER_VALUE_LENGTH ||
            /[\r\n\0]/u.test(value)
        ) {
            throw invalidContext();
        }
        result[name] = value;
    }
    return Object.freeze(result);
}

function isHeaderName(value: string): boolean {
    return (
        value.length > 0 &&
        value.length <= MAX_HEADER_NAME_LENGTH &&
        /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(value)
    );
}

function assertSafeInteger(value: number): void {
    if (!isSafeInteger(value)) {
        throw invalidContext();
    }
}

function isSafeInteger(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0;
}

function assertBinding(value: string, maximum = MAX_BINDING_LENGTH): void {
    if (!isBinding(value, maximum)) {
        throw invalidContext();
    }
}

function isBinding(value: string, maximum: number): boolean {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= maximum &&
        !/[\0\r\n]/u.test(value)
    );
}

function pruneLegacyContexts(): void {
    const now = Date.now();
    for (const [streamUrl, context] of legacyPlaybackContexts) {
        if (now - context.createdAt > PLAYBACK_CONTEXT_TTL_MS) {
            legacyPlaybackContexts.delete(streamUrl);
        }
    }
}

function invalidContext(): Error {
    return new Error('invalid-playback-context');
}

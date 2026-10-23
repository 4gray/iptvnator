/**
 * Pure helpers ported from IPTVnator's shared libraries so the dev server and
 * the Java backend can be checked against the same behaviour:
 *   - libs/shared/interfaces/.../xtream-portal.utils.ts        normalizeXtreamServerUrl
 *   - libs/shared/interfaces/.../stalker-request-identity.util.ts  buildStalkerIdentityRequestContext
 *   - libs/shared/interfaces/.../stalker-request-url.util.ts   buildStalkerRequestUrl
 *   - libs/shared/interfaces/.../stalker-cmd-encoding.util.ts  encodeStalkerCmdValue
 *   - libs/shared/interfaces/.../stalker-identity.utils.ts     serial / __cfduid helpers
 *   - libs/shared/m3u-utils/.../kodiprop.utils.ts              extractDrmFromRaw
 * plus a tiny redirect-following text fetcher used by the /api routes.
 */
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

// ---------------------------------------------------------------- xtream ---
const XTREAM_API_ENDPOINT_PATTERN = /\/(?:get|player_api|panel_api)\.php$/i;

export function normalizeXtreamServerUrl(value) {
    const trimmed = value.trim();
    if (!trimmed) throw new Error('Xtream URL is required');
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only http and https Xtream URLs are supported');
    }
    if (url.username || url.password) throw new Error('URL credentials are not supported');
    const pathWithoutTrailingSlash = url.pathname.replace(/\/+$/, '');
    const basePath = pathWithoutTrailingSlash.replace(XTREAM_API_ENDPOINT_PATTERN, '');
    return `${url.origin}${basePath}`;
}

// --------------------------------------------------------------- stalker ---
export const STALKER_MAG_USER_AGENT =
    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250';
const LEGACY_DEFAULT_STALKER_SERIAL = 'BEDACD4569BAF';
const STALKER_CFDUID_LENGTH = 32;
const STALKER_SERIAL_CFDUID_SUFFIX = 'e030245495acd6ebfc1';

function normalizeStalkerSerialNumber(serialNumber) {
    const trimmed = (serialNumber ?? '').trim();
    if (!trimmed || trimmed.toUpperCase() === LEGACY_DEFAULT_STALKER_SERIAL) return undefined;
    return trimmed;
}

function buildStalkerSerialCfduid(serialNumber) {
    const serialPrefix = serialNumber.toLowerCase().replace(/[^a-f0-9]/g, '');
    return `${serialPrefix}${STALKER_SERIAL_CFDUID_SUFFIX}`.slice(0, STALKER_CFDUID_LENGTH).padEnd(STALKER_CFDUID_LENGTH, '0');
}

export function stalkerHeaders({ macAddress, params, token, serialNumber }) {
    const effectiveSerialNumber = normalizeStalkerSerialNumber(serialNumber);
    const requestParams = { ...params };
    const isProfileRequest = requestParams.type === 'stb' && requestParams.action === 'get_profile';
    if (!isProfileRequest) {
        delete requestParams.sn;
    } else {
        if (effectiveSerialNumber) requestParams.sn = effectiveSerialNumber;
        else delete requestParams.sn;
        if (typeof requestParams.metrics === 'string') {
            try {
                const parsedMetrics = JSON.parse(requestParams.metrics);
                const nextMetrics = { ...(parsedMetrics ?? {}) };
                if (effectiveSerialNumber) nextMetrics.sn = effectiveSerialNumber;
                else delete nextMetrics.sn;
                requestParams.metrics = JSON.stringify(nextMetrics);
            } catch {
                /* keep malformed metrics as-is */
            }
        }
    }
    const cookieParts = [`mac=${macAddress}`, 'stb_lang=en_US@rg=dezzzz', 'timezone=Europe/Berlin'];
    if (effectiveSerialNumber) cookieParts.push(`__cfduid=${buildStalkerSerialCfduid(effectiveSerialNumber)}`);
    const headers = {
        Cookie: cookieParts.join('; '),
        'User-Agent': STALKER_MAG_USER_AGENT,
        'X-User-Agent': STALKER_MAG_USER_AGENT,
        Accept: '*/*',
        Connection: 'keep-alive',
        'Accept-Language': 'en-US,en;q=0.9',
    };
    if (effectiveSerialNumber) headers.SN = effectiveSerialNumber;
    if (token) headers.Authorization = `Bearer ${token}`;
    return { headers, requestParams, cookieString: headers.Cookie };
}

const SAFE_CMD_CHAR = /^[A-Za-z0-9\-_.~!*()/:?@$,+=[\]%]$/;
const utf8Encoder = new TextEncoder();

export function encodeStalkerCmdValue(value) {
    let encoded = '';
    for (const char of value) {
        if (SAFE_CMD_CHAR.test(char)) {
            encoded += char;
        } else {
            for (const byte of utf8Encoder.encode(char)) {
                encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
            }
        }
    }
    return encoded;
}

export function stalkerUrl(url, requestParams) {
    const urlObject = new URL(url);
    const queryParts = [];
    for (const [key, value] of Object.entries(requestParams)) {
        if (key === 'cmd') queryParts.push(`${key}=${encodeStalkerCmdValue(String(value))}`);
        else queryParts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
    if (!requestParams.JsHttpRequest) queryParts.push('JsHttpRequest=1-xml');
    return `${urlObject.origin}${urlObject.pathname}?${queryParts.join('&')}`;
}

// -------------------------------------------------------------- kodiprop ---
const KODIPROP_PREFIX = '#kodiprop:';
const LICENSE_TYPE_PROP = 'inputstream.adaptive.license_type';
const LICENSE_KEY_PROP = 'inputstream.adaptive.license_key';
const DRM_LEGACY_PROP = 'inputstream.adaptive.drm_legacy';
const CLEARKEY_LICENSE_TYPES = new Set(['clearkey', 'org.w3.clearkey']);
const HEX_128_BIT_PATTERN = /^[0-9a-f]{32}$/;

export function extractDrmFromRaw(raw) {
    const props = collectKodipropValues(raw);
    if (props.size === 0) return undefined;
    let licenseType = props.get(LICENSE_TYPE_PROP)?.trim() ?? '';
    let licenseKey = props.get(LICENSE_KEY_PROP)?.trim() ?? '';
    const drmLegacy = props.get(DRM_LEGACY_PROP)?.trim();
    if (drmLegacy && (!licenseType || !licenseKey)) {
        const [legacyType, ...legacyKeyParts] = drmLegacy.split('|');
        licenseType ||= legacyType?.trim() ?? '';
        licenseKey ||= legacyKeyParts.join('|').trim();
    }
    if (!licenseType && !licenseKey) return undefined;
    const normalizedType = licenseType.toLowerCase();
    const clearKeys = CLEARKEY_LICENSE_TYPES.has(normalizedType)
        ? parseClearKeys(licenseKey)
        : !normalizedType
          ? parseClearKeys(licenseKey)
          : undefined;
    if (clearKeys) return { licenseType: normalizedType || 'clearkey', supported: true, clearKeys };
    return { licenseType: normalizedType, supported: false };
}

function collectKodipropValues(raw) {
    const props = new Map();
    if (!raw) return props;
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.toLowerCase().startsWith(KODIPROP_PREFIX)) continue;
        const assignment = trimmed.slice(KODIPROP_PREFIX.length);
        const separatorIndex = assignment.indexOf('=');
        if (separatorIndex < 1) continue;
        const name = assignment.slice(0, separatorIndex).trim().toLowerCase();
        const value = assignment.slice(separatorIndex + 1).trim();
        if (name === LICENSE_TYPE_PROP || name === LICENSE_KEY_PROP || name === DRM_LEGACY_PROP) props.set(name, value);
    }
    return props;
}

function parseClearKeys(value) {
    if (!value) return undefined;
    return value.startsWith('{') ? parseClearKeysFromJson(value) : parseClearKeysFromPairs(value);
}

function parseClearKeysFromPairs(value) {
    const keys = {};
    for (const pair of value.split(',')) {
        const [kid, key, ...rest] = pair.split(':');
        if (rest.length > 0) return undefined;
        const kidHex = normalizeKeyComponent(kid);
        const keyHex = normalizeKeyComponent(key);
        if (!kidHex || !keyHex) return undefined;
        keys[kidHex] = keyHex;
    }
    return Object.keys(keys).length > 0 ? keys : undefined;
}

function parseClearKeysFromJson(value) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return Array.isArray(parsed.keys) ? parseW3cClearKeyLicense(parsed.keys) : parseClearKeyMap(parsed);
}

function parseW3cClearKeyLicense(entries) {
    const keys = {};
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') return undefined;
        const kidHex = normalizeKeyComponent(typeof entry.kid === 'string' ? entry.kid : undefined);
        const keyHex = normalizeKeyComponent(typeof entry.k === 'string' ? entry.k : undefined);
        if (!kidHex || !keyHex) return undefined;
        keys[kidHex] = keyHex;
    }
    return Object.keys(keys).length > 0 ? keys : undefined;
}

function parseClearKeyMap(record) {
    const keys = {};
    for (const [kid, key] of Object.entries(record)) {
        if (typeof key !== 'string') return undefined;
        const kidHex = normalizeKeyComponent(kid);
        const keyHex = normalizeKeyComponent(key);
        if (!kidHex || !keyHex) return undefined;
        keys[kidHex] = keyHex;
    }
    return Object.keys(keys).length > 0 ? keys : undefined;
}

function normalizeKeyComponent(value) {
    const compact = value?.trim().replace(/-/g, '').toLowerCase();
    if (!compact) return undefined;
    if (HEX_128_BIT_PATTERN.test(compact)) return compact;
    const fromBase64 = base64ToHex(value?.trim() ?? '');
    return fromBase64 && HEX_128_BIT_PATTERN.test(fromBase64) ? fromBase64 : undefined;
}

function base64ToHex(value) {
    if (!/^[A-Za-z0-9_+/-]+={0,2}$/.test(value)) return undefined;
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    try {
        return Buffer.from(base64, 'base64').toString('hex');
    } catch {
        return undefined;
    }
}

// ----------------------------------------------------------------- fetch ---
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * GET a URL as text: follows up to 5 redirects, decodes gzip/deflate/br,
 * rejects with `{status, statusText}` on HTTP errors and with `{code}` on
 * network errors — the same evidence the web backend turns into error bodies.
 */
export function fetchText(url, { headers = {}, timeoutMs = 30000, redirects = 0 } = {}) {
    return new Promise((resolvePromise, reject) => {
        let target;
        try {
            target = new URL(url);
        } catch {
            return reject(Object.assign(new Error('Invalid URL'), { code: 'ERR_INVALID_URL' }));
        }
        const client = target.protocol === 'https:' ? https : http;
        const req = client.get(
            target,
            { headers: { 'Accept-Encoding': 'gzip, deflate', ...headers }, timeout: timeoutMs },
            (res) => {
                if (REDIRECT_STATUSES.has(res.statusCode) && res.headers.location) {
                    res.resume();
                    if (redirects >= 5) return reject(Object.assign(new Error('Too many redirects'), { code: 'ERR_TOO_MANY_REDIRECTS' }));
                    const next = new URL(res.headers.location, target).href;
                    return resolvePromise(fetchText(next, { headers, timeoutMs, redirects: redirects + 1 }));
                }
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode, statusText: res.statusMessage || `HTTP ${res.statusCode}` }));
                }
                const chunks = [];
                let stream = res;
                const encoding = (res.headers['content-encoding'] || '').toLowerCase();
                if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip());
                else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
                else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
                stream.on('data', (c) => chunks.push(c));
                stream.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
                stream.on('error', (e) => reject(Object.assign(e, { code: e.code || 'ERR_BODY' })));
            }
        );
        req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
        req.on('error', (e) => reject(e));
    });
}

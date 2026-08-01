const RAW_MAX_ARRAY_LENGTH = 256;
const RAW_MAX_DEPTH = 6;
const RAW_MAX_KEYS = 2_048;
const RAW_MAX_NODES = 1_024;

const FORBIDDEN_KEYS = new Set([
    'accesstoken',
    'apikey',
    'authorization',
    'cookie',
    'cookies',
    'credential',
    'credentials',
    'deviceid',
    'headers',
    'macaddress',
    'origin',
    'password',
    'playbackurl',
    'portalauth',
    'portalurl',
    'proxyauthorization',
    'referer',
    'refreshtoken',
    'requestheaders',
    'secret',
    'serialnumber',
    'serverurl',
    'streamurl',
    'token',
    'url',
    'useragent',
    'username',
]);

function invalidSnapshot(): never {
    throw new Error('Invalid download metadata snapshot');
}

function oversizedSnapshot(): never {
    throw new Error('Download metadata snapshot is too large');
}

export function assertSafeDownloadMetadataInput(
    input: unknown,
    maxRawStringBytes: number
): void {
    const pending: Array<{ depth: number; value: unknown }> = [
        { depth: 0, value: input },
    ];
    const visited = new WeakSet<object>();
    let rawStringBytes = 0;
    let totalKeys = 0;
    let totalNodes = 0;

    while (pending.length > 0) {
        const current = pending.pop();
        if (!current) {
            continue;
        }
        const { depth, value } = current;
        totalNodes += 1;
        if (depth > RAW_MAX_DEPTH || totalNodes > RAW_MAX_NODES) {
            invalidSnapshot();
        }
        if (typeof value === 'string') {
            rawStringBytes += Buffer.byteLength(value, 'utf8');
            if (rawStringBytes > maxRawStringBytes) {
                oversizedSnapshot();
            }
            continue;
        }
        if (!value || typeof value !== 'object') {
            continue;
        }
        if (visited.has(value)) {
            continue;
        }
        visited.add(value);

        if (Array.isArray(value)) {
            if (value.length > RAW_MAX_ARRAY_LENGTH) {
                invalidSnapshot();
            }
            for (let index = 0; index < value.length; index += 1) {
                pending.push({ depth: depth + 1, value: value[index] });
            }
            continue;
        }

        for (const key in value) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                continue;
            }
            totalKeys += 1;
            rawStringBytes += Buffer.byteLength(key, 'utf8');
            if (totalKeys > RAW_MAX_KEYS) {
                invalidSnapshot();
            }
            if (rawStringBytes > maxRawStringBytes) {
                oversizedSnapshot();
            }
            const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
            if (FORBIDDEN_KEYS.has(normalizedKey)) {
                invalidSnapshot();
            }
            pending.push({
                depth: depth + 1,
                value: (value as Record<string, unknown>)[key],
            });
        }
    }
}

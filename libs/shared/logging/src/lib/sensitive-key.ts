const SENSITIVE_KEY_NAMES = new Set([
    'apikey',
    'attemptref',
    'auth',
    'authorization',
    'challengeref',
    'cookie',
    'contextref',
    'credentials',
    'deviceid',
    'deviceid2',
    'login',
    'leaseref',
    'mac',
    'macaddress',
    'mpvplayerarguments',
    'passwd',
    'password',
    'playbackcontextref',
    'principal',
    'principalkey',
    'pwd',
    'random',
    'secret',
    'sessionkey',
    'setcookie',
    'signature',
    'signature2',
    'sn',
    'token',
    'username',
    'vlcplayerarguments',
]);

const SENSITIVE_KEY_SUFFIXES = [
    'apikey',
    'attemptref',
    'authorization',
    'challengeref',
    'cookie',
    'contextref',
    'deviceid',
    'deviceid1',
    'deviceid2',
    'handshakerandom',
    'identityrevision',
    'leaseref',
    'macaddress',
    'passwd',
    'password',
    'playbackcontextref',
    'prehash',
    'principal',
    'principalkey',
    'random',
    'serialnumber',
    'signature',
    'signature1',
    'signature2',
    'secret',
    'sessionkey',
    'token',
    'username',
];

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
    const normalized = normalizeKey(key);
    return (
        SENSITIVE_KEY_NAMES.has(normalized) ||
        SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
    );
}

export function redactEmbeddedSensitivePairs(
    value: string,
    redactedValue: string
): string {
    const redactedAssignments = value.replace(
        /\b([a-z][a-z0-9_.-]*)(\s*=\s*)((?:Bearer\s+)?[^&\s,;]+)/giu,
        (match, key: string, separator: string) =>
            isSensitiveKey(key) ? `${key}${separator}${redactedValue}` : match
    );
    return redactedAssignments.replace(
        /\b([a-z0-9_.-]*(?:api[-_.]?key|attempt[-_.]?ref|auth(?:orization)?|challenge[-_.]?ref|context[-_.]?ref|cookie|credentials|device[-_.]?id[12]?|handshake[-_.]?random|lease[-_.]?ref|login|mac(?:[-_.]?address)?|passwd|password|playback[-_.]?context[-_.]?ref|prehash|principal(?:[-_.]?key)?|pwd|random|secret|serial[-_.]?number|session[-_.]?key|set[-_.]?cookie|signature[12]?|sn|token|username))(\s*:\s*)(?:Bearer\s+)?[^;,\r\n]+/giu,
        (_match, key: string, separator: string) =>
            `${key}${separator}${redactedValue}`
    );
}

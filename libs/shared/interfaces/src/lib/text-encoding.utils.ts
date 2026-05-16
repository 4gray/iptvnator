const WINDOWS_1252_REVERSE_MAP = new Map<string, number>([
    ['€', 0x80],
    ['‚', 0x82],
    ['ƒ', 0x83],
    ['„', 0x84],
    ['…', 0x85],
    ['†', 0x86],
    ['‡', 0x87],
    ['ˆ', 0x88],
    ['‰', 0x89],
    ['Š', 0x8a],
    ['‹', 0x8b],
    ['Œ', 0x8c],
    ['Ž', 0x8e],
    ['‘', 0x91],
    ['’', 0x92],
    ['“', 0x93],
    ['”', 0x94],
    ['•', 0x95],
    ['–', 0x96],
    ['—', 0x97],
    ['˜', 0x98],
    ['™', 0x99],
    ['š', 0x9a],
    ['›', 0x9b],
    ['œ', 0x9c],
    ['ž', 0x9e],
    ['Ÿ', 0x9f],
]);

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];
const SUSPICIOUS_TEXT_PATTERN =
    /(?:�|Ã[\u0080-\u00bf]|Â[\u0080-\u00bf]|â[€šƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ])/;

function toUint8Array(value: ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array {
    if (value instanceof Uint8Array) {
        return value;
    }

    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    return new Uint8Array(value);
}

function hasBom(bytes: Uint8Array, bom: number[]): boolean {
    return bom.every((byte, index) => bytes[index] === byte);
}

function normalizeCharsetLabel(value: string | undefined): string | undefined {
    const normalized = value?.trim().toLowerCase().replace(/^"|"$/g, '');
    if (!normalized) {
        return undefined;
    }

    if (['utf8', 'utf-8', 'unicode-1-1-utf-8'].includes(normalized)) {
        return 'utf-8';
    }

    if (
        [
            'latin1',
            'latin-1',
            'iso-8859-1',
            'iso8859-1',
            'windows-1252',
            'cp1252',
            'ansi',
        ].includes(normalized)
    ) {
        return 'windows-1252';
    }

    if (['utf16le', 'utf-16le'].includes(normalized)) {
        return 'utf-16le';
    }

    if (['utf16be', 'utf-16be'].includes(normalized)) {
        return 'utf-16be';
    }

    return normalized;
}

function getCharsetFromContentType(contentType?: string | null): string | undefined {
    if (!contentType) {
        return undefined;
    }

    const match = contentType.match(/(?:^|;)\s*charset\s*=\s*([^;]+)/i);
    return normalizeCharsetLabel(match?.[1]);
}

function decodeWith(label: string, bytes: Uint8Array): string {
    try {
        return new TextDecoder(label).decode(bytes);
    } catch {
        return new TextDecoder('utf-8').decode(bytes);
    }
}

function textScore(value: string): number {
    let score = 0;

    for (const char of value) {
        const code = char.charCodeAt(0);
        if (char === '\uFFFD') {
            score += 10;
        } else if ((code >= 0 && code < 0x09) || (code > 0x0d && code < 0x20)) {
            score += 4;
        } else if (code >= 0x80 && code <= 0x9f) {
            score += 3;
        }
    }

    const suspiciousMatches = value.match(
        /(?:Ã.|Â[\u0080-\u00bf]|â[€šƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ])/g
    );
    score += (suspiciousMatches?.length ?? 0) * 5;

    return score;
}

function encodeWindows1252LikeString(value: string): Uint8Array | null {
    const bytes: number[] = [];

    for (const char of value) {
        const mapped = WINDOWS_1252_REVERSE_MAP.get(char);
        if (mapped !== undefined) {
            bytes.push(mapped);
            continue;
        }

        const code = char.charCodeAt(0);
        if (code <= 0xff) {
            bytes.push(code);
            continue;
        }

        return null;
    }

    return new Uint8Array(bytes);
}

function decodeUtf8Strict(bytes: Uint8Array): string | null {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return null;
    }
}

export function repairMojibakeText(value: string): string {
    if (!value) {
        return value;
    }

    const normalized = value.normalize('NFC');
    if (!SUSPICIOUS_TEXT_PATTERN.test(normalized)) {
        return normalized;
    }

    const bytes = encodeWindows1252LikeString(normalized);
    if (!bytes) {
        return normalized;
    }

    const repaired = decodeUtf8Strict(bytes);
    if (!repaired) {
        return normalized;
    }

    return textScore(repaired) < textScore(normalized)
        ? repaired.normalize('NFC')
        : normalized;
}

export function decodeTextBytes(
    value: ArrayBuffer | ArrayBufferView | Uint8Array,
    contentType?: string | null
): string {
    let bytes = toUint8Array(value);

    if (hasBom(bytes, UTF8_BOM)) {
        bytes = bytes.slice(UTF8_BOM.length);
        return repairMojibakeText(decodeWith('utf-8', bytes));
    }

    if (hasBom(bytes, UTF16LE_BOM)) {
        bytes = bytes.slice(UTF16LE_BOM.length);
        return repairMojibakeText(decodeWith('utf-16le', bytes));
    }

    if (hasBom(bytes, UTF16BE_BOM)) {
        bytes = bytes.slice(UTF16BE_BOM.length);
        return repairMojibakeText(decodeWith('utf-16be', bytes));
    }

    const charset = getCharsetFromContentType(contentType);
    if (charset) {
        return repairMojibakeText(decodeWith(charset, bytes));
    }

    const utf8 = decodeWith('utf-8', bytes);
    const windows1252 = decodeWith('windows-1252', bytes);

    return repairMojibakeText(
        textScore(windows1252) < textScore(utf8) ? windows1252 : utf8
    );
}

export function normalizeTextValuesDeep<T>(value: T): T {
    const seen = new WeakSet<object>();

    const visit = (entry: unknown): unknown => {
        if (typeof entry === 'string') {
            return repairMojibakeText(entry);
        }

        if (!entry || typeof entry !== 'object') {
            return entry;
        }

        if (entry instanceof Date) {
            return entry;
        }

        if (seen.has(entry)) {
            return entry;
        }
        seen.add(entry);

        if (Array.isArray(entry)) {
            return entry.map((item) => visit(item));
        }

        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(entry)) {
            result[key] = visit(item);
        }

        return result;
    };

    return visit(value) as T;
}

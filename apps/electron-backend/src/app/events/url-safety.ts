import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_NETWORK_URLS_ENV = 'IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS';

/**
 * Raised when a renderer-supplied remote URL is rejected by the SSRF guard.
 */
export class UnsafeUrlError extends Error {
    readonly status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.name = 'UnsafeUrlError';
        this.status = status;
    }
}

export interface RemoteUrlPolicy {
    /** When true, private/reserved targets are permitted (default false). */
    allowPrivateNetworks?: boolean;
    /** Injectable DNS resolver. Defaults to `dns.lookup`; overridable in tests. */
    resolveHostname?: (hostname: string) => Promise<readonly string[]>;
}

export interface ValidatedRemoteUrl {
    /** Parsed URL, retaining the original hostname for TLS SNI and Host. */
    url: URL;
    /** Validated addresses that socket-level DNS lookup must be pinned to. */
    addresses?: readonly string[];
}

function isTruthyEnvironmentOptIn(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    return normalized === '1' || normalized === 'true';
}

export function isPrivateNetworkUrlAccessAllowed(): boolean {
    return isTruthyEnvironmentOptIn(process.env[PRIVATE_NETWORK_URLS_ENV]);
}

function normalizeHostname(hostname: string): string {
    let host = hostname.trim().toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) {
        host = host.slice(1, -1);
    }
    return host;
}

export function isLocalHostname(hostname: string): boolean {
    return hostname === 'localhost' || hostname.endsWith('.localhost');
}

export function isPrivateOrReservedIpv4(address: string): boolean {
    const parts = address.split('.').map((part) => Number(part));
    if (
        parts.length !== 4 ||
        parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
        return true;
    }

    const [first, second, third] = parts;
    return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 192 && second === 0) ||
        (first === 198 && (second === 18 || second === 19)) ||
        (first === 198 && second === 51 && third === 100) ||
        (first === 203 && second === 0 && third === 113) ||
        first >= 224
    );
}

function parseIpv6Words(address: string): number[] | null {
    const halves = address.split('::');
    if (halves.length > 2) {
        return null;
    }

    const parseHalf = (half: string): number[] | null => {
        if (!half) {
            return [];
        }

        const words: number[] = [];
        for (const part of half.split(':')) {
            if (part.includes('.')) {
                const octets = part.split('.').map((octet) => Number(octet));
                if (
                    octets.length !== 4 ||
                    octets.some(
                        (octet) =>
                            !Number.isInteger(octet) || octet < 0 || octet > 255
                    )
                ) {
                    return null;
                }
                words.push(
                    (octets[0] << 8) | octets[1],
                    (octets[2] << 8) | octets[3]
                );
                continue;
            }

            if (!/^[0-9a-f]{1,4}$/i.test(part)) {
                return null;
            }
            words.push(Number.parseInt(part, 16));
        }
        return words;
    };

    const left = parseHalf(halves[0]);
    const right = parseHalf(halves[1] ?? '');
    if (!left || !right) {
        return null;
    }

    if (halves.length === 1) {
        return left.length === 8 ? left : null;
    }

    const omittedWordCount = 8 - left.length - right.length;
    if (omittedWordCount < 1) {
        return null;
    }

    return [...left, ...Array<number>(omittedWordCount).fill(0), ...right];
}

function getMappedIpv4Address(address: string): string | null {
    const words = parseIpv6Words(address);
    if (
        !words ||
        words.slice(0, 5).some((word) => word !== 0) ||
        words[5] !== 0xffff
    ) {
        return null;
    }

    return [
        words[6] >> 8,
        words[6] & 0xff,
        words[7] >> 8,
        words[7] & 0xff,
    ].join('.');
}

export function isPrivateOrReservedIpv6(address: string): boolean {
    const normalized = address.toLowerCase();
    if (
        normalized === '::' ||
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        // Link-local fe80::/10 spans fe80:: through febf:: (3rd nibble 8-b).
        /^fe[89ab]/.test(normalized)
    ) {
        return true;
    }

    const mappedIpv4 = getMappedIpv4Address(normalized);
    return mappedIpv4 ? isPrivateOrReservedIpv4(mappedIpv4) : false;
}

export function isPrivateOrReservedIp(address: string): boolean {
    const version = isIP(address);
    if (version === 4) {
        return isPrivateOrReservedIpv4(address);
    }
    if (version === 6) {
        return isPrivateOrReservedIpv6(address);
    }
    return false;
}

async function defaultResolveHostname(
    hostname: string
): Promise<readonly string[]> {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
}

/**
 * Validates a renderer-supplied remote URL before the Electron main process
 * fetches it, preventing SSRF to loopback / private / reserved network
 * targets (e.g. `http://127.0.0.1`, `http://169.254.169.254` metadata).
 *
 * Returns the parsed {@link URL} when allowed, otherwise throws
 * {@link UnsafeUrlError}.
 */
export async function validateRemoteUrl(
    rawUrl: string,
    policy: RemoteUrlPolicy = {}
): Promise<ValidatedRemoteUrl> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new UnsafeUrlError('Invalid URL');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new UnsafeUrlError('Only http and https URLs are supported');
    }

    if (url.username || url.password) {
        throw new UnsafeUrlError('URL credentials are not supported');
    }

    if (policy.allowPrivateNetworks) {
        return { url };
    }

    const hostname = normalizeHostname(url.hostname);
    if (isLocalHostname(hostname) || isPrivateOrReservedIp(hostname)) {
        throw new UnsafeUrlError(
            'URL points to a private or local network address'
        );
    }

    if (isIP(hostname) !== 0) {
        return { url, addresses: [hostname] };
    }

    {
        const resolveHostname =
            policy.resolveHostname ?? defaultResolveHostname;
        let addresses: readonly string[];
        try {
            addresses = await resolveHostname(hostname);
        } catch {
            throw new UnsafeUrlError('URL host could not be resolved');
        }

        if (
            addresses.length === 0 ||
            addresses.some((address) => {
                const normalizedAddress = normalizeHostname(address);
                return (
                    isIP(normalizedAddress) === 0 ||
                    isPrivateOrReservedIp(normalizedAddress)
                );
            })
        ) {
            throw new UnsafeUrlError(
                'URL points to a private or local network address'
            );
        }

        return {
            url,
            addresses: addresses.map((address) => normalizeHostname(address)),
        };
    }
}

/**
 * Validates a URL and returns its parsed representation.
 */
export async function assertRemoteUrlAllowed(
    rawUrl: string,
    policy: RemoteUrlPolicy = {}
): Promise<URL> {
    return (await validateRemoteUrl(rawUrl, policy)).url;
}

import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { isIP } from 'net';
import { SaxesParser } from 'saxes';
import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import {
    isLocalHostname,
    isPrivateOrReservedIpv4,
    isPrivateOrReservedIpv6,
} from '../events/url-safety';

export const SSDP_ADDRESS = '239.255.255.250';
export const SSDP_PORT = 1900;
export const AV_TRANSPORT_SERVICE =
    'urn:schemas-upnp-org:service:AVTransport:1';

const MAX_DLNA_RESPONSE_BYTES = 512 * 1024;

export interface SsdpResponse {
    location: string;
    usn: string;
}

export interface RendererDescription {
    friendlyName: string;
    modelName: string;
    udn: string;
    avTransportControlUrl: string;
}

export function buildSsdpSearchRequest(): string {
    return [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'MX: 2',
        'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
        '',
        '',
    ].join('\r\n');
}

export function parseSsdpResponse(rawResponse: string): SsdpResponse | null {
    const lines = rawResponse.split(/\r?\n/);
    if (!/^HTTP\/1\.[01]\s+200\b/i.test(lines[0]?.trim() ?? '')) {
        return null;
    }

    const headers = new Map<string, string>();
    for (const line of lines.slice(1)) {
        const separator = line.indexOf(':');
        if (separator <= 0) continue;
        headers.set(
            line.slice(0, separator).trim().toLowerCase(),
            line.slice(separator + 1).trim()
        );
    }

    const location = headers.get('location');
    const usn = headers.get('usn');
    return location && usn ? { location, usn } : null;
}

export function isTrustedSsdpLocation(
    location: string,
    responderAddress: string
): boolean {
    try {
        const url = new URL(location);
        return (
            (url.protocol === 'http:' || url.protocol === 'https:') &&
            !url.username &&
            !url.password &&
            isPrivateNetworkAddress(responderAddress)
        );
    } catch {
        return false;
    }
}

export function parseRendererDescription(
    xml: string
): RendererDescription | null {
    const values: Partial<RendererDescription> = {};
    let currentServiceType = '';
    let currentControlUrl = '';
    const elements: Array<{ name: string; text: string }> = [];
    const parser = new SaxesParser();

    parser.on('opentag', (tag) => {
        elements.push({ name: localName(tag.name), text: '' });
    });
    parser.on('text', (text) => {
        const current = elements.at(-1);
        if (current) current.text += text;
    });
    parser.on('closetag', () => {
        const current = elements.pop();
        if (!current) return;
        const value = current.text.trim();

        switch (current.name) {
            case 'friendlyName':
                values.friendlyName ||= value;
                break;
            case 'modelName':
                values.modelName ||= value;
                break;
            case 'UDN':
                values.udn ||= value;
                break;
            case 'serviceType':
                currentServiceType = value;
                break;
            case 'controlURL':
                currentControlUrl = value;
                break;
            case 'service':
                if (currentServiceType === AV_TRANSPORT_SERVICE) {
                    values.avTransportControlUrl = currentControlUrl;
                }
                currentServiceType = '';
                currentControlUrl = '';
                break;
        }
    });

    try {
        parser.write(xml).close();
    } catch {
        return null;
    }

    if (!values.friendlyName || !values.avTransportControlUrl) {
        return null;
    }

    return {
        friendlyName: values.friendlyName,
        modelName: values.modelName ?? '',
        udn: values.udn ?? '',
        avTransportControlUrl: values.avTransportControlUrl,
    };
}

export function buildUpnpActionBody(
    action: string,
    values: Record<string, string>
): string {
    const fields = Object.entries(values)
        .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`)
        .join('');
    return (
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
        's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
        `<s:Body><u:${action} xmlns:u="${AV_TRANSPORT_SERVICE}">` +
        `${fields}</u:${action}></s:Body></s:Envelope>`
    );
}

export function requestPinnedText(
    targetUrl: string,
    address: string,
    options: {
        method?: 'GET' | 'POST';
        body?: string;
        headers?: Record<string, string>;
    } = {}
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!isTrustedSsdpLocation(targetUrl, address)) {
            reject(new Error('DLNA renderer URL is not trusted.'));
            return;
        }
        const target = new URL(targetUrl);
        const request =
            target.protocol === 'https:' ? httpsRequest : httpRequest;
        const body = options.body ?? '';
        const req = request(
            {
                protocol: target.protocol,
                hostname: address,
                port: target.port || undefined,
                path: `${target.pathname}${target.search}`,
                method: options.method ?? 'GET',
                servername: target.hostname,
                headers: {
                    Host: target.host,
                    ...options.headers,
                    ...(body
                        ? { 'Content-Length': Buffer.byteLength(body) }
                        : {}),
                },
            },
            (response) => {
                if (
                    !response.statusCode ||
                    response.statusCode < 200 ||
                    response.statusCode >= 300
                ) {
                    response.resume();
                    reject(
                        new Error(
                            `DLNA renderer returned HTTP ${response.statusCode ?? 0}.`
                        )
                    );
                    return;
                }

                const chunks: Buffer[] = [];
                let size = 0;
                response.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > MAX_DLNA_RESPONSE_BYTES) {
                        req.destroy(
                            new Error('DLNA response exceeded the size limit.')
                        );
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () =>
                    resolve(Buffer.concat(chunks).toString('utf8'))
                );
            }
        );
        req.setTimeout(4_000, () =>
            req.destroy(new Error('DLNA renderer request timed out.'))
        );
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

export function isReceiverFetchableUrl(streamUrl: string): boolean {
    try {
        const url = new URL(streamUrl);
        const hostname = normalizeHostname(url.hostname);
        return (
            (url.protocol === 'http:' || url.protocol === 'https:') &&
            !url.username &&
            !url.password &&
            !isLocalHostname(hostname) &&
            isReceiverFetchableHost(hostname)
        );
    } catch {
        return false;
    }
}

export function hasPlaybackHeaders(playback: ResolvedPortalPlayback): boolean {
    return Boolean(
        playback.requiresRequestHeaders ||
        playback.userAgent ||
        playback.referer ||
        playback.origin ||
        Object.keys(playback.headers ?? {}).length > 0
    );
}

function isPrivateNetworkAddress(address: string): boolean {
    if (isIP(address) !== 4) return false;
    const [a, b] = address.split('.').map(Number);
    return (
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
    );
}

function isReceiverFetchableHost(hostname: string): boolean {
    const version = isIP(hostname);
    if (version === 0) return true;
    if (version === 6) {
        if (hostname.startsWith('fc') || hostname.startsWith('fd')) {
            return true;
        }
        return !isPrivateOrReservedIpv6(hostname);
    }

    const [first, second] = hostname.split('.').map(Number);
    const isPrivateLan =
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168);
    return isPrivateLan || !isPrivateOrReservedIpv4(hostname);
}

function normalizeHostname(hostname: string): string {
    const normalized = hostname.toLowerCase();
    return normalized.startsWith('[') && normalized.endsWith(']')
        ? normalized.slice(1, -1)
        : normalized;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function localName(name: string): string {
    return name.split(':').at(-1) ?? name;
}

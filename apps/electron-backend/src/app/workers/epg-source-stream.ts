import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { isAbsolute } from 'path';
import { PassThrough, Readable, pipeline } from 'stream';
import { fileURLToPath } from 'url';
import {
    classifyEpgSourceReference,
    ElectronBridgeTrustOptions,
} from '@iptvnator/shared/interfaces';
import { isPrivateNetworkUrlAccessAllowed } from '../events/url-safety';
import { epgLogger } from '../util/epg-logger';
import { createPlaylistAgentFactory } from '../util/secure-https';
import { requestWithValidatedRedirects } from '../util/validated-axios';
import { createOptionalEpgGunzip } from './epg-optional-gunzip';
import {
    getEpgResponseContentEncoding,
    shouldGunzipEpgResponse,
} from './epg-response-utils';
import { createDecodedEpgStream } from './epg-stream-decoder';

const loggerLabel = '[EPG Worker]';

/**
 * Opens the decoded XMLTV byte stream for an EPG source.
 *
 * Remote sources go through the validated-redirect HTTP client with the
 * private-network and TLS trust policy. Local sources — a `file:` URL or an
 * absolute path the user typed in Settings or the playlist dialog — are read
 * from disk; gzip is detected from the file's own signature, so `guide.xml`,
 * `guide.xml.gz` and a gzip file without the extension all work.
 *
 * The local branch deliberately bypasses `validateRemoteUrl`, which only
 * knows http(s). It is safe because header-declared M3U sources are filtered
 * to remote links before they are ever stored (`extractM3uEpgUrls`), so a
 * downloaded playlist cannot reach this branch.
 */
export async function openEpgSourceStream(
    url: string,
    options: ElectronBridgeTrustOptions = {}
): Promise<Readable> {
    if (classifyEpgSourceReference(url) === 'local') {
        return openLocalEpgSource(url.trim());
    }
    return openRemoteEpgSource(url, options);
}

export function resolveLocalEpgSourcePath(reference: string): string {
    const trimmed = reference.trim();
    if (/^file:/i.test(trimmed)) {
        return fileURLToPath(trimmed);
    }
    if (!isAbsolute(trimmed)) {
        throw new Error('EPG file path must be absolute');
    }
    return trimmed;
}

async function openLocalEpgSource(reference: string): Promise<Readable> {
    const filePath = resolveLocalEpgSourcePath(reference);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
        info = await stat(filePath);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            throw new Error(`EPG file not found: ${filePath}`);
        }
        throw error;
    }
    if (!info.isFile()) {
        throw new Error(`EPG source is not a file: ${filePath}`);
    }

    epgLogger.log(loggerLabel, 'Reading local EPG file');
    const output = new PassThrough();
    pipeline(
        createReadStream(filePath),
        createOptionalEpgGunzip(),
        output,
        (error) => {
            if (error) output.destroy(error);
        }
    );
    return output;
}

async function openRemoteEpgSource(
    url: string,
    options: ElectronBridgeTrustOptions
): Promise<Readable> {
    // EPG URLs can originate from an untrusted M3U `url-tvg` attribute.
    // Validate every redirect and require an explicit operator opt-in for
    // private/LAN sources.
    const response = await requestWithValidatedRedirects<Readable>(
        url.trim(),
        {
            agentFactory: createPlaylistAgentFactory({
                trustedInsecureTlsHosts: options.trustedInsecureTlsHosts,
            }),
            decompress: false,
            method: 'GET',
            responseType: 'stream',
        },
        {
            allowPrivateNetworks:
                isPrivateNetworkUrlAccessAllowed() ||
                isTrustedPrivateNetworkEpgSource(url, options),
        }
    );
    const responseUrl = response.config.url;
    const isGzipped = shouldGunzipEpgResponse(url, {
        headers: response.headers,
        url: responseUrl,
    });
    const contentEncoding = getEpgResponseContentEncoding(response.headers);

    if (responseUrl && responseUrl !== url) {
        epgLogger.log(loggerLabel, 'Resolved EPG redirect');
    }
    epgLogger.log(
        loggerLabel,
        `EPG response detected as gzipped: ${isGzipped}`
    );
    if (contentEncoding) {
        epgLogger.log(
            loggerLabel,
            `EPG response content-encoding: ${contentEncoding}`
        );
    }

    if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    if (!response.data) {
        throw new Error('Response body is null');
    }

    return createDecodedEpgStream(response.data, response.headers, isGzipped);
}

function isTrustedPrivateNetworkEpgSource(
    url: string,
    options: ElectronBridgeTrustOptions
): boolean {
    const normalizedUrl = url.trim();
    return (
        options.trustedPrivateNetworkEpgUrls?.some(
            (trustedUrl) => trustedUrl.trim() === normalizedUrl
        ) ?? false
    );
}

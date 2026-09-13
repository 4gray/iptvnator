import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { PassThrough, Readable, pipeline } from 'stream';
import { ElectronBridgeTrustOptions } from '@iptvnator/shared/interfaces';
import { isPrivateNetworkUrlAccessAllowed } from '../events/url-safety';
import { epgLogger } from '../util/epg-logger';
import { resolveLocalEpgSourcePath } from '../util/epg-local-source-path';
import { createPlaylistAgentFactory } from '../util/secure-https';
import { requestWithValidatedRedirects } from '../util/validated-axios';
import { createOptionalEpgGunzip } from './epg-optional-gunzip';
import {
    getEpgResponseContentEncoding,
    shouldGunzipEpgResponse,
} from './epg-response-utils';
import { createDecodedEpgStream } from './epg-stream-decoder';

const loggerLabel = '[EPG Worker]';

/** Trust options plus the main-process verdict on a local file. */
export type EpgWorkerFetchOptions = ElectronBridgeTrustOptions & {
    /**
     * Set by `EpgWorkerService.startFetch` only after the main-process
     * authorizer allowed the path (native picker or native confirmation).
     * Never taken from the renderer.
     */
    allowLocalFile?: boolean;
};

/**
 * Opens the decoded XMLTV byte stream for an EPG source.
 *
 * Remote sources go through the validated-redirect HTTP client with the
 * private-network and TLS trust policy. Local sources — a `file:` URL or an
 * absolute path — are read from disk; gzip is detected from the file's own
 * signature, so `guide.xml`, `guide.xml.gz` and a gzip file without the
 * extension all work.
 *
 * The local branch bypasses `validateRemoteUrl`, which only knows http(s).
 * Two things make that safe: header-declared M3U sources are filtered to
 * remote links before they are stored (`extractM3uEpgUrls`), and the main
 * process opens the branch only for a path its authorizer allowed
 * (`allowLocalFile`), so neither a downloaded playlist nor a compromised
 * renderer can name an arbitrary file.
 */
export async function openEpgSourceStream(
    url: string,
    options: EpgWorkerFetchOptions = {}
): Promise<Readable> {
    const localPath = resolveLocalEpgSourcePath(url);
    if (localPath) {
        if (options.allowLocalFile !== true) {
            throw new Error('Local EPG file was not authorized');
        }
        return openLocalEpgSource(localPath);
    }
    return openRemoteEpgSource(url, options);
}

async function openLocalEpgSource(filePath: string): Promise<Readable> {
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

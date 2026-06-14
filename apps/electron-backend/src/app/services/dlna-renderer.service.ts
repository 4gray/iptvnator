import { createSocket } from 'dgram';
import {
    DlnaRendererDevice,
    ElectronBridgeErrorResult,
    hasPlaybackHeaders,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import {
    SSDP_ADDRESS,
    SSDP_PORT,
    SsdpResponse,
    buildSsdpSearchRequest,
    isReceiverFetchableUrl,
    isTrustedSsdpLocation,
    parseSsdpResponse,
    requestPinnedText,
} from './dlna-protocol';
import {
    AV_TRANSPORT_SERVICE,
    buildUpnpActionBody,
    parseRendererDescription,
} from './dlna-xml';

export {
    buildSsdpSearchRequest,
    isTrustedSsdpLocation,
    isReceiverFetchableUrl,
    parseSsdpResponse,
} from './dlna-protocol';
export { buildUpnpActionBody, parseRendererDescription } from './dlna-xml';

const DEVICE_CACHE_TTL_MS = 5 * 60_000;

interface RendererCandidate extends SsdpResponse {
    address: string;
}

interface CachedRenderer extends DlnaRendererDevice {
    address: string;
    controlUrl: string;
    expiresAt: number;
}

export class DlnaRendererService {
    private readonly renderers = new Map<string, CachedRenderer>();

    async discover(timeoutMs = 2_200): Promise<DlnaRendererDevice[]> {
        this.pruneExpiredRenderers();
        const candidates = await this.discoverCandidates(timeoutMs);
        const descriptions = await Promise.allSettled(
            candidates
                .slice(0, 32)
                .map((candidate) => this.resolveRenderer(candidate))
        );

        return descriptions.flatMap((result) =>
            result.status === 'fulfilled' && result.value
                ? [toPublicDevice(result.value)]
                : []
        );
    }

    async startPlayback(
        deviceId: string,
        playback: ResolvedPortalPlayback
    ): Promise<ElectronBridgeErrorResult> {
        if (
            typeof deviceId !== 'string' ||
            !deviceId ||
            !isPlaybackPayload(playback)
        ) {
            return {
                success: false,
                error: 'Invalid DLNA playback request.',
            };
        }

        const renderer = this.renderers.get(deviceId);
        if (!renderer || renderer.expiresAt < Date.now()) {
            return {
                success: false,
                error: 'DLNA renderer is no longer available.',
            };
        }
        if (!isReceiverFetchableUrl(playback.streamUrl)) {
            return {
                success: false,
                error: 'The stream URL cannot be fetched by a DLNA renderer.',
            };
        }
        if (hasPlaybackHeaders(playback)) {
            return {
                success: false,
                error: 'DLNA renderers cannot inherit provider request headers.',
            };
        }

        try {
            await this.sendAction(renderer, 'SetAVTransportURI', {
                InstanceID: '0',
                CurrentURI: playback.streamUrl,
                CurrentURIMetaData: '',
            });
            await this.sendAction(renderer, 'Play', {
                InstanceID: '0',
                Speed: '1',
            });
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : 'DLNA playback failed.',
            };
        }
    }

    private discoverCandidates(
        timeoutMs: number
    ): Promise<RendererCandidate[]> {
        return new Promise((resolve, reject) => {
            const socket = createSocket({ type: 'udp4', reuseAddr: true });
            const candidates = new Map<string, RendererCandidate>();
            let settled = false;
            let bound = false;

            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                if (bound) socket.close();
                if (error) {
                    reject(error);
                    return;
                }
                resolve([...candidates.values()]);
            };
            const timeout = setTimeout(() => finish(), timeoutMs);

            socket.on('message', (message, remote) => {
                const response = parseSsdpResponse(message.toString('utf8'));
                if (
                    !response ||
                    !isTrustedSsdpLocation(response.location, remote.address)
                ) {
                    return;
                }
                candidates.set(response.usn, {
                    ...response,
                    address: remote.address,
                });
            });
            socket.on('error', (error) => {
                clearTimeout(timeout);
                finish(error);
            });
            socket.bind(0, () => {
                bound = true;
                if (settled) {
                    socket.close();
                    return;
                }
                const request = Buffer.from(buildSsdpSearchRequest());
                socket.send(request, SSDP_PORT, SSDP_ADDRESS, (error) => {
                    if (error) {
                        clearTimeout(timeout);
                        finish(error);
                    }
                });
            });
        });
    }

    private async resolveRenderer(
        candidate: RendererCandidate
    ): Promise<CachedRenderer | null> {
        const xml = await requestPinnedText(
            candidate.location,
            candidate.address
        );
        const description = parseRendererDescription(xml);
        if (!description) return null;

        const controlUrl = new URL(
            description.avTransportControlUrl,
            candidate.location
        ).toString();
        if (!isTrustedSsdpLocation(controlUrl, candidate.address)) return null;

        const renderer: CachedRenderer = {
            id: description.udn || candidate.usn,
            name: description.friendlyName,
            modelName: description.modelName || undefined,
            address: candidate.address,
            controlUrl,
            expiresAt: Date.now() + DEVICE_CACHE_TTL_MS,
        };
        this.renderers.set(renderer.id, renderer);
        return renderer;
    }

    private async sendAction(
        renderer: CachedRenderer,
        action: string,
        values: Record<string, string>
    ): Promise<void> {
        const body = buildUpnpActionBody(action, values);
        await requestPinnedText(renderer.controlUrl, renderer.address, {
            method: 'POST',
            body,
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                SOAPAction: `"${AV_TRANSPORT_SERVICE}#${action}"`,
            },
        });
    }

    private pruneExpiredRenderers(): void {
        const now = Date.now();
        for (const [id, renderer] of this.renderers) {
            if (renderer.expiresAt < now) {
                this.renderers.delete(id);
            }
        }
    }
}

function toPublicDevice(renderer: CachedRenderer): DlnaRendererDevice {
    return {
        id: renderer.id,
        name: renderer.name,
        modelName: renderer.modelName,
    };
}

function isPlaybackPayload(
    playback: ResolvedPortalPlayback
): playback is ResolvedPortalPlayback {
    return Boolean(
        playback &&
        typeof playback === 'object' &&
        typeof playback.streamUrl === 'string' &&
        playback.streamUrl &&
        (playback.headers === undefined ||
            (playback.headers !== null &&
                typeof playback.headers === 'object' &&
                !Array.isArray(playback.headers)))
    );
}

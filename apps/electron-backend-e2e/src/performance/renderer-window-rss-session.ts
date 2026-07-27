import type {
    RendererProcessRssCapture,
    RendererProcessRssCaptureApi,
} from './renderer-process-rss-capture';

export interface RendererWindowIdentity {
    readonly browserWindowId: number;
    readonly webContentsId: number;
}

export interface RendererWindowRssSessionMetrics {
    readonly responsiveEvents: number;
    readonly rss: RendererProcessRssCapture;
    readonly unresponsiveEvents: number;
    readonly windowIdentity: RendererWindowIdentity;
}

export interface RendererWindowWebContents {
    readonly id: number;
    getOSProcessId(): number;
}

export interface RendererWindow {
    readonly id: number;
    readonly webContents: RendererWindowWebContents;
    off(event: 'responsive' | 'unresponsive', listener: () => void): unknown;
    on(event: 'responsive' | 'unresponsive', listener: () => void): unknown;
}

export interface RendererWindowRssSession {
    detach(): void;
    sample(): RendererWindowRssSessionMetrics;
    snapshot(): RendererWindowRssSessionMetrics;
}

export interface RendererWindowRssSessionCreateInput {
    readonly browserWindowFromId: (
        browserWindowId: number
    ) => RendererWindow | null;
    readonly browserWindowId: number;
    readonly getAppMetrics: () => readonly unknown[];
    readonly rendererRssApi: RendererProcessRssCaptureApi;
    readonly webContentsId: number;
}

export interface RendererWindowRssSessionApi {
    create(
        input: RendererWindowRssSessionCreateInput
    ): RendererWindowRssSession;
}

export function createRendererWindowRssSessionApi(): RendererWindowRssSessionApi {
    const helpers = {
        isValidIdentityId(value: unknown): value is number {
            return Number.isSafeInteger(value) && Number(value) > 0;
        },

        create(
            input: RendererWindowRssSessionCreateInput
        ): RendererWindowRssSession {
            if (!helpers.isValidIdentityId(input.browserWindowId)) {
                throw new Error('renderer-browser-window-id-invalid');
            }
            if (!helpers.isValidIdentityId(input.webContentsId)) {
                throw new Error('renderer-web-contents-id-invalid');
            }

            let browserWindow: RendererWindow | null = null;
            try {
                browserWindow = input.browserWindowFromId(
                    input.browserWindowId
                );
            } catch {
                throw new Error('renderer-browser-window-missing');
            }
            if (browserWindow === null) {
                throw new Error('renderer-browser-window-missing');
            }
            if (browserWindow.id !== input.browserWindowId) {
                throw new Error('renderer-browser-window-identity-mismatch');
            }
            const webContents = browserWindow.webContents;
            if (
                webContents === null ||
                typeof webContents !== 'object' ||
                webContents.id !== input.webContentsId
            ) {
                throw new Error('renderer-web-contents-identity-mismatch');
            }

            const windowIdentity = Object.freeze({
                browserWindowId: input.browserWindowId,
                webContentsId: input.webContentsId,
            });
            let rendererRss = input.rendererRssApi.create(
                helpers.readOsProcessId(webContents),
                helpers.readAppMetrics(input.getAppMetrics)
            );
            let responsiveEvents = 0;
            let unresponsiveEvents = 0;
            let detached = false;
            const callbacks = {
                onResponsive(): void {
                    if (!detached) {
                        responsiveEvents += 1;
                    }
                },
                onUnresponsive(): void {
                    if (!detached) {
                        unresponsiveEvents += 1;
                    }
                },
                snapshot(): RendererWindowRssSessionMetrics {
                    return Object.freeze({
                        responsiveEvents,
                        rss: rendererRss,
                        unresponsiveEvents,
                        windowIdentity,
                    });
                },
            };
            browserWindow.on('unresponsive', callbacks.onUnresponsive);
            try {
                browserWindow.on('responsive', callbacks.onResponsive);
            } catch (error) {
                browserWindow.off('unresponsive', callbacks.onUnresponsive);
                throw error;
            }

            return Object.freeze({
                detach(): void {
                    if (detached) {
                        return;
                    }
                    detached = true;
                    browserWindow.off('unresponsive', callbacks.onUnresponsive);
                    browserWindow.off('responsive', callbacks.onResponsive);
                },
                sample(): RendererWindowRssSessionMetrics {
                    if (!detached) {
                        rendererRss = input.rendererRssApi.sample(
                            rendererRss,
                            helpers.readOsProcessId(webContents),
                            helpers.readAppMetrics(input.getAppMetrics)
                        );
                    }
                    return callbacks.snapshot();
                },
                snapshot: callbacks.snapshot,
            });
        },

        readAppMetrics(
            getAppMetrics: () => readonly unknown[]
        ): readonly unknown[] {
            try {
                const metrics = getAppMetrics();
                return Array.isArray(metrics) ? metrics : [];
            } catch {
                return [];
            }
        },

        readOsProcessId(webContents: RendererWindowWebContents): unknown {
            try {
                return webContents.getOSProcessId();
            } catch {
                return null;
            }
        },
    };

    return Object.freeze({ create: helpers.create });
}

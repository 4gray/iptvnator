import { AppConfig } from '../../environments/environment';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';

export interface IptvnatorRuntimeConfig {
    readonly BACKEND_URL?: string;
}

export function resolveBackendUrl(
    runtimeConfig: IptvnatorRuntimeConfig | undefined,
    fallbackUrl: string
): string {
    const runtimeUrl = runtimeConfig?.BACKEND_URL?.trim();
    return runtimeUrl || fallbackUrl;
}

export function getRuntimeBackendUrl(): string {
    if (sourceConnection() && !globalThis.window?.electron) return sourceConnection()!.apiUrl;
    return resolveBackendUrl(
        globalThis.window?.__IPTVNATOR_CONFIG__,
        AppConfig.BACKEND_URL
    );
}

export interface ServiceWorkerRuntimeContext {
    readonly electronBridge?: unknown;
    readonly protocol?: string;
    readonly tvShell?: boolean;
}

/** The native bridge exists at document start, before the layout script adds CSS classes. */
export function isAndroidShellRuntime(): boolean {
    const scope = globalThis.window as
        | (Window & { TvShell?: { postMessage?: unknown } })
        | undefined;
    if (!scope) return false;
    const classes = scope.document.documentElement.classList;
    return (
        typeof scope.TvShell?.postMessage === 'function' ||
        'HostedAccessApi' in scope ||
        classes.contains('android-tv-shell') ||
        classes.contains('tv-shell')
    );
}

function getDefaultServiceWorkerRuntimeContext(): ServiceWorkerRuntimeContext {
    const browserWindow = globalThis.window as
        (Window & { electron?: unknown }) | undefined;

    return {
        electronBridge: browserWindow?.electron,
        protocol:
            browserWindow?.location?.protocol ?? globalThis.location?.protocol,
        tvShell: isAndroidShellRuntime(),
    };
}

export function shouldEnableServiceWorker(
    production = AppConfig.production,
    navigatorRef: Navigator | undefined = globalThis.navigator,
    runtimeContext = getDefaultServiceWorkerRuntimeContext()
): boolean {
    return (
        production &&
        !!navigatorRef &&
        'serviceWorker' in navigatorRef &&
        !runtimeContext.electronBridge &&
        !runtimeContext.tvShell &&
        runtimeContext.protocol !== 'file:'
    );
}

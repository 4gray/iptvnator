import { AppConfig } from '../../environments/environment';

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
    return resolveBackendUrl(
        globalThis.window?.__IPTVNATOR_CONFIG__,
        AppConfig.BACKEND_URL
    );
}

export function shouldEnableServiceWorker(
    production = AppConfig.production,
    navigatorRef: Navigator | undefined = globalThis.navigator
): boolean {
    return production && !!navigatorRef && 'serviceWorker' in navigatorRef;
}

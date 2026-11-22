import type {
    AndroidLibraryControls,
    AndroidServerKind,
} from '@iptvnator/services';
import { assertSourceInstance } from '@iptvnator/services/source-sync';

export function isHostedLibrarySource(
    origin?: string,
    selectedApi?: string
): boolean {
    return (
        !!origin &&
        (!selectedApi ||
            selectedApi === location.origin + '/api' ||
            selectedApi === origin + '/api')
    );
}

/** Older inline Android shells can inspect public metadata accessible to the WebView. */
export async function inspectAndroidServer(
    controls: AndroidLibraryControls,
    apiUrl: string
): Promise<AndroidServerKind> {
    if (controls.inspectServer && new URL(apiUrl).pathname.endsWith('/api'))
        return controls.inspectServer(apiUrl);
    const response = await fetch(`${apiUrl}/v1/instance`, {
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(8000),
    });
    const secure = new URL(apiUrl).protocol === 'https:';
    if (!response.ok) {
        const challenge = response.headers.get('WWW-Authenticate') ?? '';
        if (!secure || response.status !== 401) return 'unknown';
        const metadata =
            /^Bearer\s+.*?\bresource_metadata\s*=\s*"([^"]+)"/i.exec(
                challenge
            )?.[1];
        try {
            const url = new URL(metadata ?? '');
            return url.protocol === 'https:' && !url.username && !url.password
                ? 'access'
                : 'unknown';
        } catch {
            return 'unknown';
        }
    }
    const info: unknown = await response.json();
    assertSourceInstance(info);
    if (info.auth !== 'token' && info.auth !== 'none') return 'unknown';
    if (info.capabilities?.includes('cloudflare-device-v1'))
        return secure ? 'access' : 'unknown';
    if (
        info.auth === 'token' &&
        info.capabilities?.includes('browser-pairing-v1')
    ) {
        const { savedOrigin, paired } = controls.libraryConnection();
        // The legacy native connect flow validates the instance before reusing its credential.
        return paired && savedOrigin + '/api' === apiUrl ? 'reconnect' : 'pair';
    }
    return info.auth === 'token' ? 'token' : 'sources';
}

export type AndroidConnectionStep =
    'sources' | 'token' | 'native' | 'invitation';

/** Commit native navigation only while the form still selects the inspected address. */
export async function selectAndroidServer(
    controls: AndroidLibraryControls,
    apiUrl: string,
    approvalAddress: string,
    stillSelected: () => boolean
): Promise<AndroidConnectionStep | undefined> {
    const kind = await inspectAndroidServer(controls, apiUrl);
    if (!stillSelected()) return undefined;
    switch (kind) {
        case 'sources':
        case 'token':
            if (
                controls.connectNasLibrary &&
                new URL(apiUrl).pathname.endsWith('/api')
            ) {
                controls.connectNasLibrary(apiUrl, kind === 'token');
                return 'native';
            }
            return kind;
        case 'pair':
        case 'reconnect':
        case 'access': {
            const address = new URL(apiUrl);
            if (address.pathname !== '/api')
                throw new Error('SOURCE_SYNC.INCOMPATIBLE');
            if (kind === 'pair')
                controls.pairLibrary(address.origin, approvalAddress.trim());
            else controls.connectLibrary(address.origin);
            return kind === 'access' ? 'invitation' : 'native';
        }
        default:
            throw new Error('SOURCE_SYNC.CONNECTION_FAILED');
    }
}

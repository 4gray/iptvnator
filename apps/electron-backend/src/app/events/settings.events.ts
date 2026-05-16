import { app, ipcMain } from 'electron';
import {
    normalizeExternalPlayerArguments,
    SourceVpnPreparationRequest,
} from 'shared-interfaces';
import {
    APP_LANGUAGE,
    ACCELERATED_DOWNLOADS,
    BACKGROUND_METADATA_WARMUP,
    BACKGROUND_METADATA_WARMUP_AT_LOGIN,
    BACKGROUND_METADATA_WARMUP_CONCURRENCY,
    BACKGROUND_METADATA_WARMUP_SCHEDULE,
    MPV_PLAYER_ARGUMENTS,
    MPV_REUSE_INSTANCE,
    PROTON_VPN_INTEGRATION_ENABLED,
    REDIRECT_INDIRECT_STREAMS_TO_DIRECT_SOURCE,
    store,
    VPN_INTEGRATION_ENABLED,
    VPN_LOCATION,
    VPN_PROVIDER,
    VPN_RESTORE_ON_EXIT,
    VLC_PLAYER_ARGUMENTS,
    VLC_REUSE_INSTANCE,
} from '../services/store.service';
import { httpServer } from '../server/http-server';
import {
    benchmarkHttpDownload,
    resolveAcceleratedPlaybackUrl,
} from '../services/accelerated-http-download.service';
import {
    normalizeProtonVpnLocation,
    protonVpnIntegration,
} from '../services/proton-vpn-integration.service';

function configureMetadataWarmupLoginItem(enabled: boolean): void {
    if (!app.isReady()) {
        app.whenReady()
            .then(() => configureMetadataWarmupLoginItem(enabled))
            .catch(() => undefined);
        return;
    }

    app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true,
        args: ['--metadata-warmup'],
    });
}

const SUPPORTED_APP_LANGUAGES = new Set([
    'ar',
    'ary',
    'en',
    'ko',
    'ru',
    'de',
    'es',
    'zh',
    'zhtw',
    'fr',
    'it',
    'tr',
    'ja',
    'nl',
    'by',
    'pl',
    'pt',
    'el',
]);

function normalizeAppLanguage(value: unknown): string | null {
    const language = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SUPPORTED_APP_LANGUAGES.has(language) ? language : null;
}

export default class SettingsEvents {
    static bootstrapSettingsEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle('SETTINGS_UPDATE', (_event, arg) => {
    console.log('Received SETTINGS_UPDATE with data:', arg);

    const language = normalizeAppLanguage(arg.language);
    if (language) {
        store.set(APP_LANGUAGE, language);
    }

    if (arg.mpvPlayerArguments !== undefined) {
        store.set(
            MPV_PLAYER_ARGUMENTS,
            normalizeExternalPlayerArguments(arg.mpvPlayerArguments)
        );
    }

    if (arg.vlcPlayerArguments !== undefined) {
        store.set(
            VLC_PLAYER_ARGUMENTS,
            normalizeExternalPlayerArguments(arg.vlcPlayerArguments)
        );
    }

    // Only set values that are defined
    if (arg.mpvReuseInstance !== undefined) {
        store.set(MPV_REUSE_INSTANCE, arg.mpvReuseInstance);
    }

    if (arg.vlcReuseInstance !== undefined) {
        store.set(VLC_REUSE_INSTANCE, arg.vlcReuseInstance);
    }

    if (arg.acceleratedDownloads !== undefined) {
        store.set(ACCELERATED_DOWNLOADS, Boolean(arg.acceleratedDownloads));
    }

    if (arg.redirectIndirectStreamsToDirectSource !== undefined) {
        store.set(
            REDIRECT_INDIRECT_STREAMS_TO_DIRECT_SOURCE,
            Boolean(arg.redirectIndirectStreamsToDirectSource)
        );
    }

    if (arg.backgroundMetadataWarmup !== undefined) {
        const enabled = Boolean(arg.backgroundMetadataWarmup);
        store.set(
            BACKGROUND_METADATA_WARMUP,
            enabled
        );
        if (!enabled && arg.backgroundMetadataWarmupAtLogin === undefined) {
            store.set(BACKGROUND_METADATA_WARMUP_AT_LOGIN, false);
            configureMetadataWarmupLoginItem(false);
        }
    }

    if (arg.backgroundMetadataWarmupAtLogin !== undefined) {
        const warmupEnabled =
            arg.backgroundMetadataWarmup !== undefined
                ? Boolean(arg.backgroundMetadataWarmup)
                : store.get(BACKGROUND_METADATA_WARMUP, true);
        const enabled =
            Boolean(arg.backgroundMetadataWarmupAtLogin) && warmupEnabled;
        store.set(BACKGROUND_METADATA_WARMUP_AT_LOGIN, enabled);
        configureMetadataWarmupLoginItem(enabled);
    }

    if (arg.backgroundMetadataWarmupSchedule !== undefined) {
        const schedule = String(arg.backgroundMetadataWarmupSchedule);
        if (
            schedule === 'every-opening' ||
            schedule === 'weekly' ||
            schedule === 'monthly'
        ) {
            store.set(BACKGROUND_METADATA_WARMUP_SCHEDULE, schedule);
        }
    }

    if (arg.backgroundMetadataWarmupConcurrency !== undefined) {
        const concurrency = Number(arg.backgroundMetadataWarmupConcurrency);
        if (Number.isFinite(concurrency)) {
            store.set(
                BACKGROUND_METADATA_WARMUP_CONCURRENCY,
                Math.max(1, Math.min(8, Math.floor(concurrency)))
            );
        }
    }

    if (
        arg.vpnIntegrationEnabled !== undefined ||
        arg.protonVpnIntegrationEnabled !== undefined
    ) {
        store.set(
            VPN_INTEGRATION_ENABLED,
            Boolean(
                arg.vpnIntegrationEnabled ?? arg.protonVpnIntegrationEnabled
            )
        );
    }

    if (arg.vpnProvider !== undefined) {
        store.set(
            VPN_PROVIDER,
            arg.vpnProvider === 'proton' ? 'proton' : 'none'
        );
    } else if (arg.protonVpnIntegrationEnabled !== undefined) {
        store.set(
            VPN_PROVIDER,
            arg.protonVpnIntegrationEnabled ? 'proton' : 'none'
        );
    }

    if (arg.vpnLocation !== undefined || arg.protonVpnLocation !== undefined) {
        store.set(
            VPN_LOCATION,
            normalizeProtonVpnLocation(arg.vpnLocation ?? arg.protonVpnLocation)
        );
    }

    if (
        arg.vpnRestoreOnExit !== undefined
    ) {
        store.set(VPN_RESTORE_ON_EXIT, Boolean(arg.vpnRestoreOnExit));
    }

    if (
        arg.fastDownloadEnabled !== undefined &&
        arg.acceleratedDownloads === undefined
    ) {
        store.set(ACCELERATED_DOWNLOADS, Boolean(arg.fastDownloadEnabled));
    }

    if (
        arg.redirectIndirectSourcesToDirect !== undefined &&
        arg.redirectIndirectStreamsToDirectSource === undefined
    ) {
        store.set(
            REDIRECT_INDIRECT_STREAMS_TO_DIRECT_SOURCE,
            Boolean(arg.redirectIndirectSourcesToDirect)
        );
    }

    if (
        arg.vpnIntegrationEnabled !== undefined ||
        arg.vpnProvider !== undefined ||
        arg.vpnLocation !== undefined ||
        arg.protonVpnIntegrationEnabled !== undefined ||
        arg.protonVpnLocation !== undefined
    ) {
        const shouldStartHidden = store.get(
            VPN_INTEGRATION_ENABLED,
            store.get(PROTON_VPN_INTEGRATION_ENABLED, true)
        );

        void protonVpnIntegration
            .applyPreference({ startClient: shouldStartHidden })
            .catch((error) =>
                console.warn('Failed to apply Proton VPN preference.', error)
            );
    }

    // Handle remote control settings
    if (
        arg.remoteControl !== undefined ||
        arg.remoteControlPort !== undefined
    ) {
        const enabled = arg.remoteControl ?? store.get('remoteControl', false);
        const port =
            arg.remoteControlPort ?? store.get('remoteControlPort', 8765);

        // Save to store
        if (arg.remoteControl !== undefined) {
            store.set('remoteControl', enabled);
        }
        if (arg.remoteControlPort !== undefined) {
            store.set('remoteControlPort', port);
        }

        // Update HTTP server
        httpServer.updateSettings(enabled, port);
    }
});

ipcMain.handle('VPN_INTEGRATION_STATUS', () => protonVpnIntegration.getStatus());

ipcMain.handle(
    'SOURCE_VPN_PREPARE',
    async (_event, payload: SourceVpnPreparationRequest) => {
        const provider = payload?.provider === 'proton' ? 'proton' : 'none';
        const location = normalizeProtonVpnLocation(payload?.location);

        if (provider !== 'proton') {
            return {
                enabled: false,
                location,
                platform: process.platform,
                provider,
                reason: 'unsupported-provider',
                status: 'disabled',
                lastCheckedAt: Date.now(),
            };
        }

        const result = await protonVpnIntegration.prepareForSourceNetwork({
            provider,
            location,
            sourceId: payload?.sourceId,
            sourceTitle: payload?.sourceTitle,
        });

        return {
            ...result,
            platform: process.platform,
        };
    }
);

ipcMain.handle('SET_METADATA_WARMUP_LOGIN_ITEM', (_event, enabled: boolean) => {
    const normalized = Boolean(enabled);
    store.set(BACKGROUND_METADATA_WARMUP_AT_LOGIN, normalized);
    configureMetadataWarmupLoginItem(normalized);
    return { success: true, enabled: normalized };
});

ipcMain.handle(
    'ACCELERATED_PLAYBACK_RESOLVE_URL',
    async (
        _event,
        payload: {
            url: string;
            headers?: Record<string, string>;
        }
    ) => {
        if (!store.get(ACCELERATED_DOWNLOADS, true)) {
            return {
                url: payload.url,
                accelerated: false,
                rangeSupported: false,
                status: 0,
                reason: 'Acceleration disabled in settings',
            };
        }

        return resolveAcceleratedPlaybackUrl(payload.url, payload.headers);
    }
);

ipcMain.handle(
    'HTTP_DOWNLOAD_BENCHMARK',
    async (
        _event,
        payload: {
            url: string;
            headers?: Record<string, string>;
            maxBytes?: number;
            timeoutMs?: number;
        }
    ) => benchmarkHttpDownload(payload)
);

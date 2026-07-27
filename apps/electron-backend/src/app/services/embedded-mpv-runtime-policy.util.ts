import { app } from 'electron';

export const EMBEDDED_MPV_EXPERIMENT_ENV =
    'IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT';

function isTruthy(value: string | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes(
        (value ?? '').trim().toLowerCase()
    );
}

/**
 * Packaged desktop builds enable embedded MPV by default. Unpackaged runs
 * require the regular experiment opt-in before any embedded-MPV engine may
 * start or relax BrowserWindow security settings.
 */
export function isEmbeddedMpvFeatureEnabled(): boolean {
    return app.isPackaged || isTruthy(process.env[EMBEDDED_MPV_EXPERIMENT_ENV]);
}

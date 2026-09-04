import { resolveEmbeddedMpvSessionOptionArguments } from '@iptvnator/shared/interfaces';
import {
    EMBEDDED_MPV_AUTO_RECONNECT,
    EMBEDDED_MPV_EXTRA_OPTIONS,
    store,
} from './store.service';

/**
 * Per-session knobs captured when an embedded MPV session is created. They
 * come from the main-process settings mirror (see `store.service.ts`), so a
 * settings change applies to the next session, never to a running one.
 *
 * Read here rather than inside `EmbeddedMpvNativeService`: the config store
 * is constructed at module load and would drag electron-conf into every
 * consumer of the service, including its unit tests.
 */
export interface EmbeddedMpvSessionOptions {
    /**
     * `key=value` lines the addon applies after its built-in options: the
     * network defaults first, then the user's allowed lines.
     */
    extraOptions: string[];
    /** Reload a dropped stream automatically (see `embedded-mpv-reconnect.ts`). */
    autoReconnect: boolean;
}

export function readEmbeddedMpvSessionOptions(): EmbeddedMpvSessionOptions {
    return {
        extraOptions: resolveEmbeddedMpvSessionOptionArguments(
            store.get(EMBEDDED_MPV_EXTRA_OPTIONS, '')
        ),
        autoReconnect: store.get(EMBEDDED_MPV_AUTO_RECONNECT, true) !== false,
    };
}

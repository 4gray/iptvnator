import type { ExternalPlayerLaunchContext } from '../events/external-player-launch-context';
import {
    getDefaultVlcPath,
    isRunningInFlatpak,
    resolveExternalPlayerLaunchContext,
} from '../events/external-player-launch-context';
import { store, VLC_PLAYER_PATH } from './store.service';

export function resolveDefaultVlcLaunchContext(): ExternalPlayerLaunchContext {
    const isFlatpak = isRunningInFlatpak();
    return resolveExternalPlayerLaunchContext(
        'vlc',
        store.get(VLC_PLAYER_PATH)?.trim() || getDefaultVlcPath({ isFlatpak }),
        { isFlatpak }
    );
}

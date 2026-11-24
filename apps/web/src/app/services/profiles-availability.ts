import {
    EnvironmentInjector,
    effect,
    inject,
    signal,
    type Signal,
} from '@angular/core';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import { loadProfilesRuntime } from './profiles-runtime.providers';
import { PROFILES_UI_ENABLED_TOKEN } from './profiles-ui-enabled';

/**
 * Whether Settings → Profiles exists: the UI switch is on, a source server is
 * connected and it supports profiles. While the switch is off this touches
 * neither the network nor the runtime chunk.
 */
export function profilesAvailabilityFactory(): Signal<boolean> {
    const available = signal(false);
    if (!inject(PROFILES_UI_ENABLED_TOKEN)) return available.asReadonly();
    const injector = inject(EnvironmentInjector);
    void loadProfilesRuntime(injector)
        .then((runtime) =>
            effect(
                () => available.set(runtime.capable() && !!sourceConnection()),
                { injector }
            )
        )
        .catch(() => undefined);
    return available.asReadonly();
}

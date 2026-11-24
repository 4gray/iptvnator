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
 * Whether Settings → Profiles exists: the UI switch is on and a source server
 * is connected that supports profiles, or has not answered yet. While the
 * switch is off this touches neither the network nor the runtime chunk.
 */
export function profilesAvailabilityFactory(): Signal<boolean> {
    const available = signal(false);
    if (!inject(PROFILES_UI_ENABLED_TOKEN)) return available.asReadonly();
    const injector = inject(EnvironmentInjector);
    available.set(!!sourceConnection());
    void loadProfilesRuntime(injector)
        .then((runtime) =>
            effect(
                () => {
                    const answer = runtime.state();
                    available.set(
                        !!sourceConnection() &&
                            (runtime.capable() ||
                                answer === 'idle' ||
                                answer === 'checking' ||
                                answer === 'offline')
                    );
                },
                { injector }
            )
        )
        .catch(() => available.set(false));
    return available.asReadonly();
}

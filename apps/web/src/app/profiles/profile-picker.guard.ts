import { EnvironmentInjector, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import {
    readActiveProfileId,
    readProfilesStart,
} from '../services/profiles-preferences';
import {
    loadProfileSwitch,
    loadProfilesRuntime,
} from '../services/profiles-runtime.providers';
import { needsPicker } from '../services/profiles-start';
import { PROFILES_UI_ENABLED_TOKEN } from '../services/profiles-ui-enabled';
import {
    PROFILE_PICKER_PATH,
    profilePickedThisSession,
    sanitizeReturnUrl,
} from './profile-picker-route';

/** Start-up never waits longer than this for the server to answer. */
export const PROFILES_GUARD_TIMEOUT_MS = 1500;

/**
 * Sends the first workspace entry of a session to "Who's watching?" when the
 * household uses profiles and this device asks. Anything else, an error, an
 * offline server or a slow answer included, lets the user in as Default.
 * Static imports stay tiny: the runtime loads lazily and only when the UI
 * switch is on.
 */
export const profilePickerGuard: CanActivateFn = async (_route, state) => {
    if (!inject(PROFILES_UI_ENABLED_TOKEN)) return true;
    const instanceId = sourceConnection()?.instanceId;
    if (!instanceId || profilePickedThisSession()) return true;
    const injector = inject(EnvironmentInjector);
    const router = inject(Router);
    const ask = await withTimeout(
        shouldAsk(injector, instanceId),
        PROFILES_GUARD_TIMEOUT_MS
    );
    if (ask === null) {
        void loadProfilesRuntime(injector)
            .then((runtime) => runtime.holdDefault())
            .catch(() => undefined);
    }
    return ask
        ? router.createUrlTree([PROFILE_PICKER_PATH], {
              queryParams: { returnUrl: sanitizeReturnUrl(state.url) },
          })
        : true;
};

/** `/profile-picker` exists only while the UI switch is on and a server is connected. */
export const profilePickerRouteGuard: CanActivateFn = () =>
    inject(PROFILES_UI_ENABLED_TOKEN) && sourceConnection()
        ? true
        : inject(Router).parseUrl('/workspace');

async function shouldAsk(
    injector: EnvironmentInjector,
    instanceId: string
): Promise<boolean | null> {
    try {
        const runtime = await loadProfilesRuntime(injector);
        await runtime.refresh();
        // No verified answer (offline, refused, checking): stay on Default
        // for the session, so a later poll cannot switch the viewer.
        if (runtime.state() !== 'ready') return null;
        const ask = needsPicker({
            uiEnabled: true,
            connected: true,
            capable: runtime.capable(),
            enabled: runtime.enabled(),
            startPref: readProfilesStart(instanceId),
            lastId: readActiveProfileId(instanceId),
            profiles: runtime.list()?.profiles ?? [],
        });
        // The restored profile's state loads before the first screen; the
        // picker's own choice is picked up by the switch's effect.
        const profileSwitch = await loadProfileSwitch(injector);
        if (!ask) await profileSwitch.apply(runtime.scope());
        return ask;
    } catch {
        return null;
    }
}

/** `null` means no answer in time (or a failure): carry on as Default. */
function withTimeout(
    work: Promise<boolean | null>,
    ms: number
): Promise<boolean | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

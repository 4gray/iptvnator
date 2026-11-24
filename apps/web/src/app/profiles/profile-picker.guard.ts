import { EnvironmentInjector, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import {
    readActiveProfileId,
    readProfilesStart,
} from '../services/profiles-preferences';
import { loadProfilesRuntime } from '../services/profiles-runtime.providers';
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
    return ask
        ? router.createUrlTree([PROFILE_PICKER_PATH], {
              queryParams: { returnUrl: sanitizeReturnUrl(state.url) },
          })
        : true;
};

/** `/profile-picker` exists only while the UI switch is on. */
export const profilePickerRouteGuard: CanActivateFn = () =>
    inject(PROFILES_UI_ENABLED_TOKEN)
        ? true
        : inject(Router).parseUrl('/workspace');

async function shouldAsk(
    injector: EnvironmentInjector,
    instanceId: string
): Promise<boolean> {
    try {
        const runtime = await loadProfilesRuntime(injector);
        await runtime.refresh();
        return (
            runtime.state() === 'ready' &&
            needsPicker({
                uiEnabled: true,
                connected: true,
                capable: runtime.capable(),
                enabled: runtime.enabled(),
                startPref: readProfilesStart(instanceId),
                lastId: readActiveProfileId(instanceId),
                profiles: runtime.list()?.profiles ?? [],
            })
        );
    } catch {
        return false;
    }
}

function withTimeout(work: Promise<boolean>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

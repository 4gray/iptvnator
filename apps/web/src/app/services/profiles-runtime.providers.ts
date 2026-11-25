import type { EnvironmentInjector } from '@angular/core';
import type { ProfilesRuntime } from './profiles-runtime';
import type { ProfileSwitchService } from './profile-switch.service';

/** The switch drives the sync runtimes, so it loads with the runtime and never at start-up. */
export async function loadProfileSwitch(
    injector: EnvironmentInjector
): Promise<ProfileSwitchService> {
    const { ProfileSwitchService } = await import('./profile-switch.service');
    return injector.get(ProfileSwitchService);
}

/** Keeps the runtime and its transport out of the initial bundle. */
export async function loadProfilesRuntime(
    injector: EnvironmentInjector
): Promise<ProfilesRuntime> {
    const { ProfilesRuntime } = await import('./profiles-runtime');
    return injector.get(ProfilesRuntime);
}

import type { EnvironmentInjector } from '@angular/core';
import type { ProfilesRuntime } from './profiles-runtime';

/** Keeps the runtime and its transport out of the initial bundle. */
export async function loadProfilesRuntime(
    injector: EnvironmentInjector
): Promise<ProfilesRuntime> {
    const { ProfilesRuntime } = await import('./profiles-runtime');
    return injector.get(ProfilesRuntime);
}

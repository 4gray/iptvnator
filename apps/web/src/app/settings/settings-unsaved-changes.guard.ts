import { CanDeactivateFn } from '@angular/router';

/**
 * Structural contract instead of importing the (lazy-loaded) settings
 * component into the eager route config.
 */
export interface SettingsLeaveConfirmation {
    confirmLeaveWithUnsavedChanges(): Promise<boolean> | boolean;
}

function isInsideSettingsArea(url: string): boolean {
    const path = url.split('?')[0];
    return (
        path === '/workspace/settings' ||
        path.startsWith('/workspace/settings/')
    );
}

/**
 * Guards only the EXIT from the settings area. Section switches
 * (`/settings/general` → `/settings/playback`) re-run deactivation checks
 * because the route's `:section` param changes, but they share the one
 * settings form and can never lose staged edits — asking there would be
 * pure nagging, so they pass unconditionally.
 */
export const settingsUnsavedChangesGuard: CanDeactivateFn<
    SettingsLeaveConfirmation
> = (component, _currentRoute, _currentState, nextState) => {
    if (isInsideSettingsArea(nextState.url)) {
        return true;
    }

    return component.confirmLeaveWithUnsavedChanges();
};

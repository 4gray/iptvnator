import { effect, inject, Signal, signal } from '@angular/core';
import {
    WorkspaceBackPhoneSlot,
    WorkspaceBackTarget,
} from '@iptvnator/portal/shared/util';
import { WorkspaceBackNavigationService } from './workspace-back-navigation.service';

export interface WorkspaceBackRegistration {
    /** Registers only while this returns true; always when omitted. */
    readonly available?: () => boolean;
    /** Accessible name and tooltip; the generic "Back" when omitted. */
    readonly label?: Signal<string | null>;
    /** True while Escape on the page runs the same action; false if omitted. */
    readonly escapeShortcut?: Signal<boolean>;
    readonly phoneDrawerToggle?: WorkspaceBackPhoneSlot;
    run(): void;
}

/**
 * Offers a page's Back in the workspace header instead of an arrow of its
 * own, for as long as the calling component lives and `available` holds.
 * Must be called in an injection context (a field initializer or the
 * constructor).
 */
export function registerWorkspaceBack(
    registration: WorkspaceBackRegistration
): void {
    const backNavigation = inject(WorkspaceBackNavigationService);
    const target: WorkspaceBackTarget = {
        label: registration.label ?? signal(null),
        escapeShortcut: registration.escapeShortcut ?? signal(false),
        phoneDrawerToggle: registration.phoneDrawerToggle,
        run: () => registration.run(),
    };
    effect((onCleanup) => {
        if (registration.available && !registration.available()) return;
        onCleanup(backNavigation.register(target));
    });
}

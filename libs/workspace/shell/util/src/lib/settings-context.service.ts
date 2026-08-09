import { Injectable, signal } from '@angular/core';

export interface SettingsNavItem {
    id: string;
    label: string;
    icon: string;
}

/**
 * Bridge between the routed settings page and the workspace context panel:
 * the page publishes which section pages exist for the current runtime, the
 * panel renders them as router links to `/workspace/settings/:section`.
 * Active-state highlighting comes from the router (`routerLinkActive`), not
 * from this service.
 */
@Injectable({ providedIn: 'root' })
export class SettingsContextService {
    readonly sections = signal<SettingsNavItem[]>([]);

    setSections(items: SettingsNavItem[]): void {
        this.sections.set(items);
    }

    reset(): void {
        this.sections.set([]);
    }
}

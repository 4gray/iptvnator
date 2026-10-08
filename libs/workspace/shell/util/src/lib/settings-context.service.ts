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
    /**
     * Settings search matches per section id while a search term is active,
     * `null` otherwise. The panel shows the counts and mutes sections
     * without matches.
     */
    readonly matchCounts = signal<Readonly<Record<string, number>> | null>(
        null
    );

    setSections(items: SettingsNavItem[]): void {
        this.sections.set(items);
    }

    setMatchCounts(counts: Readonly<Record<string, number>> | null): void {
        this.matchCounts.set(counts);
    }

    reset(): void {
        this.sections.set([]);
        this.matchCounts.set(null);
    }
}

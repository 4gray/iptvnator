import { Injectable, signal } from '@angular/core';

export interface SettingsNavItem {
    id: string;
    label: string;
    icon: string;
    /** Navigation group id; items without one are pinned to the footer. */
    group?: string;
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
    /** Sections holding staged (unsaved) edits; the panel marks them. */
    readonly dirtySections = signal<ReadonlySet<string>>(new Set());
    /** Installed app version, shown beside the About entry. */
    readonly version = signal<string | null>(null);
    /** An update can be installed; the About entry carries a badge. */
    readonly updateAvailable = signal(false);

    setSections(items: SettingsNavItem[]): void {
        this.sections.set(items);
    }

    setMatchCounts(counts: Readonly<Record<string, number>> | null): void {
        this.matchCounts.set(counts);
    }

    setDirtySections(sections: ReadonlySet<string>): void {
        this.dirtySections.set(sections);
    }

    setVersion(version: string | null): void {
        this.version.set(version);
    }

    setUpdateAvailable(available: boolean): void {
        this.updateAvailable.set(available);
    }

    reset(): void {
        this.sections.set([]);
        this.matchCounts.set(null);
        this.dirtySections.set(new Set());
        this.version.set(null);
        this.updateAvailable.set(false);
    }
}

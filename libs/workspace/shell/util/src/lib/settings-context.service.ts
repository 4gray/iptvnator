import { Injectable, signal } from '@angular/core';

export interface SettingsNavItem {
    id: string;
    label: string;
    icon: string;
}

@Injectable({ providedIn: 'root' })
export class SettingsContextService {
    readonly sections = signal<SettingsNavItem[]>([]);
    readonly activeSection = signal<string>('general');
    readonly pendingScrollTarget = signal<string | null>(null);

    setSections(items: SettingsNavItem[]): void {
        this.sections.set(items);
    }

    setActiveSection(id: string): void {
        this.activeSection.set(id);
    }

    navigateToSection(id: string): void {
        this.activeSection.set(id);
        this.pendingScrollTarget.set(id);
    }

    clearPendingScrollTarget(): void {
        this.pendingScrollTarget.set(null);
    }

    reset(): void {
        this.sections.set([]);
        this.activeSection.set('general');
        this.pendingScrollTarget.set(null);
    }
}

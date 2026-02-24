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

    setSections(items: SettingsNavItem[]): void {
        this.sections.set(items);
    }

    setActiveSection(id: string): void {
        this.activeSection.set(id);
    }

    reset(): void {
        this.sections.set([]);
        this.activeSection.set('general');
    }
}

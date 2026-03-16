import { Injectable, signal } from '@angular/core';

export interface WorkspaceHeaderAction {
    id: string;
    icon: string;
    tooltipKey: string;
    ariaLabelKey: string;
    run: () => void;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceHeaderContextService {
    readonly action = signal<WorkspaceHeaderAction | null>(null);

    setAction(action: WorkspaceHeaderAction): void {
        this.action.set(action);
    }

    clearAction(id?: string): void {
        if (id && this.action()?.id !== id) {
            return;
        }

        this.action.set(null);
    }
}

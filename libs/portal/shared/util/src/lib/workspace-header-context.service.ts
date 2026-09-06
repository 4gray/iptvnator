import { Injectable, signal } from '@angular/core';
import { WorkspaceHeaderCommandMetadata } from './workspace-view-command.types';

export interface WorkspaceHeaderAction {
    id: string;
    icon: string;
    tooltipKey: string;
    ariaLabelKey: string;
    /** Pressed/highlighted state for toggling actions (e.g. the guide). */
    active?: () => boolean;
    run: () => void;
    palette?: WorkspaceHeaderCommandMetadata;
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

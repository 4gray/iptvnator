import { Injectable, computed, inject, signal } from '@angular/core';
import {
    WorkspaceHeaderAction,
    WorkspaceHeaderContextService,
} from './workspace-header-context.service';
import { WorkspaceCommandContribution } from './workspace-view-command.types';

interface RegisteredWorkspaceCommand {
    token: symbol;
    command: WorkspaceCommandContribution;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceViewCommandService {
    private readonly headerContext = inject(WorkspaceHeaderContextService);
    private readonly registeredCommands = signal<RegisteredWorkspaceCommand[]>(
        []
    );

    readonly commands = computed<readonly WorkspaceCommandContribution[]>(
        () => {
            const commands = this.registeredCommands().map(
                (entry) => entry.command
            );
            const headerAction = this.headerContext.action();
            const headerCommand = headerAction
                ? this.toHeaderCommand(headerAction)
                : null;

            return headerCommand ? [headerCommand, ...commands] : commands;
        }
    );

    registerCommand(command: WorkspaceCommandContribution): () => void {
        const token = Symbol(command.id);
        this.registeredCommands.update((entries) => [
            ...entries,
            { token, command },
        ]);

        return () => {
            this.registeredCommands.update((entries) =>
                entries.filter((entry) => entry.token !== token)
            );
        };
    }

    private toHeaderCommand(
        action: WorkspaceHeaderAction
    ): WorkspaceCommandContribution {
        const palette = action.palette;

        return {
            id: action.id,
            group: palette?.group ?? 'view',
            icon: action.icon,
            labelKey: palette?.labelKey ?? action.tooltipKey,
            labelParams: palette?.labelParams,
            descriptionKey: palette?.descriptionKey,
            descriptionParams: palette?.descriptionParams,
            priority: palette?.priority ?? 0,
            keywords: palette?.keywords,
            visible: palette?.visible,
            // The header action's own gate wins: a disabled button must not
            // leave a runnable command behind in the palette.
            enabled: action.disabled
                ? () => !action.disabled?.()
                : palette?.enabled,
            run: () => action.run(),
        };
    }
}

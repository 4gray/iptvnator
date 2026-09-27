import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
    WorkspaceCommandSelection,
    WorkspaceResolvedCommandItem,
    WorkspaceViewCommandService,
} from '@iptvnator/portal/shared/util';
import {
    WorkspaceCommandPaletteComponent,
    WorkspaceCommandPaletteData,
} from '../../workspace-command-palette/workspace-command-palette.component';
import { RecentCommandsService } from '../../recent-commands';
import { WorkspacePlayerCommandsContributor } from '../../workspace-player-commands';
import { SettingsSearchService } from '@iptvnator/workspace/shell/util/settings-search';
import { buildSettingsPaletteCommands } from './helpers/workspace-settings-commands';
import {
    buildCommandPaletteItems,
    CommandBuilderContext,
} from './helpers/workspace-shell-command-builders';

@Injectable()
export class WorkspaceShellCommandPaletteService {
    private readonly dialog = inject(MatDialog);
    private readonly viewCommands = inject(WorkspaceViewCommandService);
    private readonly recentCommands = inject(RecentCommandsService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly playerCommands = inject(
        WorkspacePlayerCommandsContributor
    );
    private readonly settingsSearch = inject(SettingsSearchService);

    private commandPaletteRef: MatDialogRef<
        WorkspaceCommandPaletteComponent,
        WorkspaceCommandSelection | undefined
    > | null = null;
    private commandPaletteOpening = false;

    buildPaletteCommands(
        ctx: CommandBuilderContext
    ): WorkspaceResolvedCommandItem[] {
        return buildCommandPaletteItems(ctx, this.viewCommands.commands());
    }

    openCommandPalette(ctx: CommandBuilderContext, initialQuery: string): void {
        if (this.commandPaletteRef) {
            this.commandPaletteRef.close();
            return;
        }

        if (this.commandPaletteOpening) {
            return;
        }

        const embeddedMpvSupportLoads = [
            this.playerCommands.ensureEmbeddedMpvSupportLoaded(),
            this.settingsSearch.ensureEmbeddedMpvSupportLoaded(),
        ].filter((load): load is Promise<void> => load !== undefined);
        if (embeddedMpvSupportLoads.length > 0) {
            this.commandPaletteOpening = true;
            // A failed probe only hides its commands; it must not block opening.
            void Promise.all(
                embeddedMpvSupportLoads.map((load) =>
                    load.catch(() => undefined)
                )
            ).finally(() => {
                this.commandPaletteOpening = false;
                this.openResolvedCommandPalette(ctx, initialQuery);
            });
            return;
        }

        this.openResolvedCommandPalette(ctx, initialQuery);
    }

    private openResolvedCommandPalette(
        ctx: CommandBuilderContext,
        initialQuery: string
    ): void {
        if (this.commandPaletteRef) {
            return;
        }

        const settings = buildSettingsPaletteCommands(
            this.settingsSearch,
            ctx.translate
        );
        const commands = [
            ...this.buildPaletteCommands(ctx),
            ...settings.commands,
        ];
        const recentIds = this.recentCommands
            .entries()
            .map((entry) => entry.id);
        const dialogRef = this.dialog.open<
            WorkspaceCommandPaletteComponent,
            WorkspaceCommandPaletteData,
            WorkspaceCommandSelection | undefined
        >(WorkspaceCommandPaletteComponent, {
            width: 'min(760px, 92vw)',
            maxWidth: '92vw',
            panelClass: 'workspace-command-palette-overlay',
            autoFocus: false,
            data: {
                commands,
                query: initialQuery,
                recentIds,
                searchSettings: settings.search,
            },
        });
        this.commandPaletteRef = dialogRef;

        dialogRef
            .afterClosed()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((selection) => {
                this.commandPaletteRef = null;
                if (!selection) {
                    return;
                }

                const command = commands.find(
                    (item) =>
                        item.id === selection.commandId &&
                        item.visible &&
                        item.enabled
                );
                if (!command) {
                    return;
                }

                command.run({ query: selection.query.trim() });
                this.recentCommands.record(command.id);
            });
    }
}

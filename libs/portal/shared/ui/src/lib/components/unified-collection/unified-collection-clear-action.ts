import { effect, inject, Signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
    CollectionContentType,
    UnifiedCollectionItem,
    WorkspaceViewCommandService,
} from '@iptvnator/portal/shared/util';
import { DialogService } from '@iptvnator/ui/components';
import {
    CollectionMode,
    UnifiedCollectionDataService,
} from './unified-collection-data.service';
import { resolveClearCollectionDialogKeys } from './unified-collection-labels';

export interface ClearCollectionAction {
    /** Ask for confirmation, then clear every row of the tab on screen. */
    run(): void;
}

/**
 * "Clear this tab" for a unified collection. The rows leave the screen as
 * soon as the user confirms; a favorites write that then fails puts the
 * collection back the way storage has it. Must run in an injection context.
 */
export function createClearCollectionAction(options: {
    mode: Signal<CollectionMode>;
    /** Rows of the tab on screen — the ones this clears. */
    items: Signal<UnifiedCollectionItem[]>;
    typeLabelKey: Signal<string>;
    /** Whether those rows came from a single playlist; names the wording. */
    isPlaylistScope: () => boolean;
    data: UnifiedCollectionDataService;
    /** Drop the cleared tab and move to one that still has rows. */
    dropCurrentType: () => void;
    /** Restore the collection from storage after a failed write. */
    reload: () => Promise<void>;
}): ClearCollectionAction {
    const dialogService = inject(DialogService);
    const translate = inject(TranslateService);

    const clearFavorites = async (
        itemsToRemove: UnifiedCollectionItem[]
    ): Promise<void> => {
        options.dropCurrentType();

        try {
            await options.data.clearFavorites(itemsToRemove);
        } catch {
            await options.reload();
        }
    };

    return {
        run(): void {
            const itemsToRemove = options.items();
            if (itemsToRemove.length === 0) {
                return;
            }

            const isFavorites = options.mode() === 'favorites';
            const type = translate.instant(options.typeLabelKey());
            const { titleKey, messageKey } = resolveClearCollectionDialogKeys(
                options.mode(),
                options.isPlaylistScope()
            );

            dialogService.openConfirmDialog({
                title: translate.instant(titleKey, { type }),
                message: translate.instant(messageKey, { type }),
                onConfirm: async () => {
                    if (isFavorites) {
                        await clearFavorites(itemsToRemove);
                        return;
                    }

                    options.dropCurrentType();
                    options.data.removeRecentItemsBatch(itemsToRemove);
                },
            });
        },
    };
}

export interface ClearCollectionViewCommandHost {
    /** Only the workspace shell renders a command palette to register into. */
    isWorkspaceLayout: boolean;
    mode: Signal<CollectionMode>;
    selectedContentType: Signal<CollectionContentType>;
    /** Rows the command would clear; with none there is nothing to offer. */
    currentTypeItems: Signal<UnifiedCollectionItem[]>;
    labelKey: Signal<string>;
    typeLabelKey: Signal<string>;
    run: () => void;
}

/**
 * Publish "clear the current tab" to the workspace command palette while the
 * tab has rows. Must run in an injection context (the hosting component's
 * field initializer or constructor).
 */
export function setupClearCollectionViewCommand(
    host: ClearCollectionViewCommandHost
): void {
    const workspaceViewCommands = inject(WorkspaceViewCommandService);
    const translate = inject(TranslateService);
    const typeParams = () => ({
        type: translate.instant(host.typeLabelKey()),
    });

    effect((onCleanup) => {
        if (!host.isWorkspaceLayout || host.currentTypeItems().length === 0) {
            return;
        }

        onCleanup(
            workspaceViewCommands.registerCommand({
                id: `unified-collection-clear-current-${host.mode()}`,
                group: 'view',
                icon: 'delete_sweep',
                labelKey: host.labelKey(),
                labelParams: typeParams,
                descriptionKey:
                    'WORKSPACE.SHELL.COMMANDS.CLEAR_CURRENT_VIEW_DESCRIPTION',
                descriptionParams: typeParams,
                keywords: () =>
                    host.mode() === 'favorites'
                        ? [
                              'clear',
                              'favorites',
                              'remove',
                              host.selectedContentType(),
                          ]
                        : [
                              'clear',
                              'recent',
                              'history',
                              host.selectedContentType(),
                          ],
                priority: 10,
                run: host.run,
            })
        );
    });
}

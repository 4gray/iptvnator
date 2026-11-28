import { Injectable, inject } from '@angular/core';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { LazyMatDialog } from '@iptvnator/ui/components/lazy-dialog';
import { dialogSize } from '@iptvnator/ui/dialog/dialog-size';
import { firstValueFrom } from 'rxjs';

interface EditedFolder {
    id: string;
    name: string;
}

interface MoveOptions {
    add?: boolean;
}

export type FavoriteFolderDialogData =
    | { action: 'create' }
    | { action: 'rename' | 'remove'; folder: EditedFolder }
    | {
          action: 'move';
          items: readonly UnifiedCollectionItem[];
          options?: MoveOptions;
      };

@Injectable({ providedIn: 'root' })
export class FavoriteFolderDialogs {
    private readonly lazyDialog = inject(LazyMatDialog);

    async create(): Promise<string | null> {
        const result = await this.open({ action: 'create' });
        return typeof result === 'string' ? result : null;
    }

    async rename(folder: EditedFolder): Promise<boolean> {
        return (await this.open({ action: 'rename', folder })) === true;
    }

    async remove(folder: EditedFolder): Promise<boolean> {
        return (await this.open({ action: 'remove', folder })) === true;
    }

    async move(
        items: readonly UnifiedCollectionItem[],
        options?: MoveOptions
    ): Promise<boolean> {
        if (!items.length) return false;
        return (
            (await this.open({
                action: 'move',
                items: [...items],
                options,
            })) === true
        );
    }

    private async open(data: FavoriteFolderDialogData) {
        const [dialog, { FavoriteFolderDialogComponent }] = await Promise.all([
            this.lazyDialog.resolve(),
            import('./favorite-folder-dialog.component'),
        ]);
        const ref = dialog.open<
            InstanceType<typeof FavoriteFolderDialogComponent>,
            FavoriteFolderDialogData,
            string | true
        >(FavoriteFolderDialogComponent, {
            ...dialogSize(data.action === 'remove' ? 'sm' : 'md'),
            data,
        });
        return firstValueFrom(ref.afterClosed());
    }
}

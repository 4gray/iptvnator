import type { MatDialogConfig } from '@angular/material/dialog';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { dialogSize } from '@iptvnator/ui/components/dialog-size';

/** One frame for Sources, switcher, dashboard and workspace entry points. */
export function playlistInfoDialogConfig(
    playlist: PlaylistMeta
): MatDialogConfig<PlaylistMeta> {
    return { ...dialogSize('md'), data: playlist };
}

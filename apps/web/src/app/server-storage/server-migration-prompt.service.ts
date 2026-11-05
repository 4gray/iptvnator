import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { NavigationEnd, Router } from '@angular/router';
import { filter, take } from 'rxjs';
import { ServerStorageStatusService } from '@iptvnator/services';
import { dialogSize } from '@iptvnator/ui/components/dialog-size';
import {
    ServerMigrationService,
    type ServerMigrationPlaylist,
} from '@iptvnator/services/server-storage';

/** Opens the migration dialog once, after the first navigation settles. */
@Injectable({ providedIn: 'root' })
export class ServerMigrationPrompt {
    private readonly router = inject(Router);
    private readonly dialog = inject(MatDialog);
    private readonly status = inject(ServerStorageStatusService);
    private readonly migration = inject(ServerMigrationService);

    schedule(): void {
        this.router.events
            .pipe(
                filter((event) => event instanceof NavigationEnd),
                take(1)
            )
            .subscribe(() => void this.offer());
    }

    private async offer(): Promise<void> {
        if (this.status.state() !== 'online') {
            return;
        }
        let playlists: ServerMigrationPlaylist[] | null;
        try {
            playlists = await this.migration.offerOnStartup();
        } catch {
            return; // IndexedDB or server unreadable: ask again next start.
        }
        if (!playlists) {
            return;
        }
        const { ServerMigrationDialogComponent } =
            await import('./server-migration-dialog.component');
        this.dialog.open(ServerMigrationDialogComponent, {
            ...dialogSize('md'),
            data: playlists,
            disableClose: true,
        });
    }
}

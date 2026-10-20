import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import {
    ServerMigrationService,
    type ServerMigrationPlaylist,
    type ServerMigrationResult,
} from '@iptvnator/services/server-storage';
import { SOURCE_TYPE_ICONS } from '@iptvnator/shared/interfaces';
import {
    DialogFooterDirective,
    DialogShellComponent,
} from '@iptvnator/ui/components';

@Component({
    selector: 'app-server-migration-dialog',
    imports: [
        DialogFooterDirective,
        DialogShellComponent,
        MatButtonModule,
        MatDialogModule,
        MatIconModule,
        MatProgressSpinnerModule,
        TranslatePipe,
    ],
    templateUrl: './server-migration-dialog.component.html',
    styleUrl: './server-migration-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerMigrationDialogComponent {
    private readonly migration = inject(ServerMigrationService);
    private readonly dialogRef = inject(
        MatDialogRef<ServerMigrationDialogComponent>
    );

    readonly playlists =
        inject<readonly ServerMigrationPlaylist[]>(MAT_DIALOG_DATA);
    readonly icons = SOURCE_TYPE_ICONS;
    readonly busy = signal(false);
    readonly failed = signal(false);
    readonly result = signal<ServerMigrationResult | null>(null);

    notNow(): void {
        this.migration.skip();
        this.dialogRef.close();
    }

    async move(): Promise<void> {
        this.busy.set(true);
        this.failed.set(false);
        try {
            this.result.set(await this.migration.moveBrowserData());
        } catch {
            this.failed.set(true);
        } finally {
            this.busy.set(false);
        }
    }

    /** The library was replaced underneath every open view. */
    reload(): void {
        window.location.reload();
    }
}

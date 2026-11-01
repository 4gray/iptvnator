import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslatePipe } from '@ngx-translate/core';

export interface ImportProgressView {
    title: string;
    source: string;
    phase: string;
    detail: string;
    progress: string;
    tone: 'remote' | 'local' | null;
    current: number;
    total: number;
    canCancel?: boolean;
    cancelling?: boolean;
}

/** Shared scanning presentation for workspace imports and edit-time catalog refreshes. */
@Component({
    selector: 'app-import-progress',
    imports: [MatButtonModule, MatProgressBarModule, TranslatePipe],
    templateUrl: './import-progress.component.html',
    styleUrl: './import-progress.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportProgressComponent {
    readonly view = input.required<ImportProgressView>();
    readonly inline = input(false);
    readonly cancelRequested = output<void>();
}

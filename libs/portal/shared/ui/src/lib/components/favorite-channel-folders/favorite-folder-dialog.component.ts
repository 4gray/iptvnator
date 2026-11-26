import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    Injector,
    afterNextRender,
    computed,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import type { ErrorStateMatcher } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
    FavoriteChannelFoldersService,
    FavoriteFolderNameError,
} from '@iptvnator/portal/shared/data-access';
import {
    DialogFooterDirective,
    DialogShellComponent,
} from '@iptvnator/ui/dialog';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import { TranslatePipe } from '@ngx-translate/core';
import type { FavoriteFolderDialogData } from './favorite-folder-dialogs.service';

const NAME_ERRORS = {
    blank: 'WORKSPACE.FAVORITE_FOLDERS.NAME_REQUIRED',
    duplicate: 'WORKSPACE.FAVORITE_FOLDERS.NAME_DUPLICATE',
    'too-long': 'WORKSPACE.FAVORITE_FOLDERS.NAME_TOO_LONG',
} as const;

const NEW_FOLDER = Symbol('new folder');
const WITHOUT_FOLDER = Symbol('without folder');
type Destination = string | typeof NEW_FOLDER | typeof WITHOUT_FOLDER;

@Component({
    providers: [provideFormFieldDefaults()],
    imports: [
        DialogFooterDirective,
        DialogShellComponent,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        ReactiveFormsModule,
        TranslatePipe,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './favorite-folder-dialog.component.html',
    styles: `
        :host,
        mat-form-field {
            display: block;
        }
        mat-form-field + mat-form-field {
            margin-block-start: var(--app-space-3);
        }
        p {
            margin: 0;
            overflow-wrap: anywhere;
        }
        .save-error {
            color: var(--app-status-danger);
        }
    `,
})
export class FavoriteFolderDialogComponent {
    private readonly store = inject(FavoriteChannelFoldersService);
    private readonly ref =
        inject<MatDialogRef<FavoriteFolderDialogComponent, string | true>>(
            MatDialogRef
        );
    private readonly injector = inject(Injector);
    private readonly nameInput =
        viewChild<ElementRef<HTMLInputElement>>('nameInput');
    private readonly confirm = viewChild.required('confirm', {
        read: ElementRef,
    });

    protected readonly data = inject<FavoriteFolderDialogData>(MAT_DIALOG_DATA);
    protected readonly newFolder = NEW_FOLDER;
    protected readonly withoutFolder = WITHOUT_FOLDER;
    protected readonly folders = this.store.folders;
    protected readonly pending = signal(false);
    protected readonly nameError = signal<string | null>(null);
    protected readonly saveError = signal(false);
    protected readonly errorMatcher: ErrorStateMatcher = {
        isErrorState: () => this.nameError() !== null,
    };
    protected readonly name = new FormControl(
        this.data.action === 'rename' ? this.data.folder.name : '',
        { nonNullable: true }
    );

    private readonly currentFolders = computed(
        () =>
            new Set(
                this.data.action === 'move' && !this.data.options?.add
                    ? this.data.items.map((item) => this.store.folderOf(item))
                    : []
            )
    );
    protected readonly destination = signal<Destination>(
        this.initialDestination()
    );
    protected readonly showName = computed(
        () =>
            this.data.action === 'create' ||
            this.data.action === 'rename' ||
            (this.data.action === 'move' && this.destination() === NEW_FOLDER)
    );
    protected readonly canSubmit = computed(() => {
        if (this.pending()) return false;
        if (this.data.action !== 'move') return true;
        const target = this.destination();
        if (target === NEW_FOLDER) return true;
        if (target === WITHOUT_FOLDER) return !this.isUnavailable(null);
        return (
            this.folders().some((folder) => folder.id === target) &&
            !this.isUnavailable(target)
        );
    });

    protected readonly labels = this.getLabels();

    protected isUnavailable(id: string | null): boolean {
        const assignments = this.currentFolders();
        return assignments.size === 1 && assignments.has(id);
    }

    protected chooseDestination(destination: Destination): void {
        this.destination.set(destination);
        this.clearErrors();
        if (destination === NEW_FOLDER) {
            this.focusName();
        }
    }

    protected clearErrors(): void {
        this.nameError.set(null);
        this.saveError.set(false);
    }

    protected cancel(): void {
        if (!this.pending()) this.ref.close();
    }

    protected async submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (!this.canSubmit()) return;

        this.clearErrors();
        this.pending.set(true);
        this.ref.disableClose = true;
        try {
            this.ref.close(await this.save());
        } catch (error) {
            if (error instanceof FavoriteFolderNameError) {
                this.nameError.set(NAME_ERRORS[error.reason]);
                this.focusName();
            } else {
                this.saveError.set(true);
                afterNextRender(() => this.confirm().nativeElement.focus(), {
                    injector: this.injector,
                });
            }
            this.pending.set(false);
            this.ref.disableClose = false;
        }
    }

    private focusName(): void {
        afterNextRender(() => this.nameInput()?.nativeElement.focus(), {
            injector: this.injector,
        });
    }

    private initialDestination(): Destination {
        const firstFolder = this.folders().find(
            ({ id }) => !this.isUnavailable(id)
        );
        if (
            this.data.action === 'move' &&
            this.data.options?.add &&
            firstFolder
        ) {
            return firstFolder.id;
        }
        if (!this.isUnavailable(null)) return WITHOUT_FOLDER;
        return firstFolder?.id ?? NEW_FOLDER;
    }

    private async save(): Promise<string | true> {
        const data = this.data;
        const name = this.name.value;
        switch (data.action) {
            case 'create':
                return this.store.create(name);
            case 'rename':
                await this.store.rename(data.folder.id, name);
                break;
            case 'remove':
                await this.store.remove(data.folder.id);
                break;
            case 'move': {
                const target = this.destination();
                const destination =
                    target === NEW_FOLDER
                        ? { name }
                        : target === WITHOUT_FOLDER
                          ? null
                          : target;
                await this.store.move(data.items, destination, data.options);
                break;
            }
        }
        return true;
    }

    private getLabels() {
        switch (this.data.action) {
            case 'create':
                return {
                    icon: 'create_new_folder',
                    title: 'WORKSPACE.FAVORITE_FOLDERS.NEW_FOLDER',
                    confirm: 'WORKSPACE.FAVORITE_FOLDERS.CREATE_CONFIRM',
                };
            case 'rename':
                return {
                    icon: 'edit',
                    title: 'WORKSPACE.FAVORITE_FOLDERS.RENAME_TITLE',
                    confirm: 'SETTINGS.UNSAVED_DIALOG_SAVE',
                };
            case 'remove':
                return {
                    icon: 'delete',
                    title: 'WORKSPACE.FAVORITE_FOLDERS.DELETE_TITLE',
                    confirm: 'PORTALS.ERROR_VIEW.DELETE',
                };
            case 'move':
                if (this.data.options?.add) {
                    return {
                        icon: 'folder_open',
                        title: 'WORKSPACE.FAVORITE_FOLDERS.ADD_TITLE',
                        confirm: 'WORKSPACE.FAVORITE_FOLDERS.ADD_CONFIRM',
                    };
                }
                return {
                    icon: 'folder_open',
                    title:
                        this.data.items.length > 1
                            ? 'WORKSPACE.FAVORITE_FOLDERS.MOVE_CHANNELS_TITLE'
                            : 'WORKSPACE.FAVORITE_FOLDERS.MOVE_TITLE',
                    confirm: 'WORKSPACE.FAVORITE_FOLDERS.MOVE_CONFIRM',
                };
        }
    }
}

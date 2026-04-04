import {
    AfterViewInit,
    Component,
    ElementRef,
    computed,
    effect,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

export type WorkspaceCommandScope = 'global' | 'playlist' | 'section';

export type WorkspaceCommandId =
    | 'global-search'
    | 'playlist-search'
    | 'open-global-favorites'
    | 'open-downloads'
    | 'open-global-recent'
    | 'open-settings'
    | 'open-sources'
    | 'open-dashboard'
    | 'add-playlist'
    | 'refresh-playlist'
    | 'playlist-info'
    | 'account-info'
    | 'go-to-vod'
    | 'go-to-live'
    | 'go-to-series';

export interface WorkspaceCommandItem {
    id: WorkspaceCommandId;
    label: string;
    description: string;
    scope: WorkspaceCommandScope;
    enabled: boolean;
}

export interface WorkspaceCommandSelection {
    commandId: WorkspaceCommandId;
    query: string;
}

interface WorkspaceCommandPaletteData {
    commands: WorkspaceCommandItem[];
    query?: string;
}

interface WorkspaceCommandGroup {
    scope: WorkspaceCommandScope;
    items: WorkspaceCommandItem[];
}

@Component({
    selector: 'app-workspace-command-palette',
    imports: [MatDialogModule, MatIconModule, TranslatePipe],
    templateUrl: './workspace-command-palette.component.html',
    styleUrl: './workspace-command-palette.component.scss',
})
export class WorkspaceCommandPaletteComponent implements AfterViewInit {
    private readonly dialogRef = inject(
        MatDialogRef<
            WorkspaceCommandPaletteComponent,
            WorkspaceCommandSelection | undefined
        >
    );
    private readonly data =
        inject<WorkspaceCommandPaletteData>(MAT_DIALOG_DATA);

    private readonly queryInputRef =
        viewChild<ElementRef<HTMLInputElement>>('queryInput');

    readonly query = signal(this.data?.query ?? '');
    readonly selectedIndex = signal(0);

    readonly filteredCommands = computed(() => {
        const term = this.query().trim().toLowerCase();
        if (!term) {
            return this.data.commands;
        }

        return this.data.commands.filter((command) => {
            const haystack =
                `${command.label} ${command.description}`.toLowerCase();
            return haystack.includes(term);
        });
    });

    readonly commandGroups = computed<WorkspaceCommandGroup[]>(() => {
        const commands = this.filteredCommands();
        const grouped: WorkspaceCommandGroup[] = [];

        const buildGroup = (
            scope: WorkspaceCommandScope
        ): WorkspaceCommandGroup | null => {
            const items = commands.filter((command) => command.scope === scope);
            if (items.length === 0) {
                return null;
            }
            return { scope, items };
        };

        const groups = [
            buildGroup('global'),
            buildGroup('playlist'),
            buildGroup('section'),
        ].filter((group): group is WorkspaceCommandGroup => group !== null);

        grouped.push(...groups);
        return grouped;
    });

    readonly flatCommands = computed(() =>
        this.commandGroups().reduce<WorkspaceCommandItem[]>(
            (items, group) => items.concat(group.items),
            []
        )
    );

    constructor() {
        effect(() => {
            const items = this.flatCommands();
            if (items.length === 0) {
                this.selectedIndex.set(-1);
                return;
            }

            const currentIndex = this.selectedIndex();
            if (currentIndex < 0 || currentIndex >= items.length) {
                this.selectedIndex.set(0);
            }
        });
    }

    ngAfterViewInit(): void {
        queueMicrotask(() => {
            this.queryInputRef()?.nativeElement.focus();
            this.queryInputRef()?.nativeElement.select();
        });
    }

    onQueryInput(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        this.query.set(target?.value ?? '');
    }

    onInputKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.moveSelection(1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.moveSelection(-1);
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            this.selectCurrent();
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            this.dialogRef.close();
        }
    }

    onCommandHover(command: WorkspaceCommandItem): void {
        const index = this.flatCommands().findIndex(
            (item) => item.id === command.id
        );
        if (index >= 0) {
            this.selectedIndex.set(index);
        }
    }

    onCommandClick(command: WorkspaceCommandItem): void {
        if (!command.enabled) {
            return;
        }

        this.dialogRef.close({
            commandId: command.id,
            query: this.query().trim(),
        });
    }

    isCommandSelected(command: WorkspaceCommandItem): boolean {
        const index = this.flatCommands().findIndex(
            (item) => item.id === command.id
        );
        return index >= 0 && this.selectedIndex() === index;
    }

    private moveSelection(direction: 1 | -1): void {
        const items = this.flatCommands();
        if (items.length === 0) {
            return;
        }

        const currentIndex = this.selectedIndex();
        const safeIndex = currentIndex < 0 ? 0 : currentIndex;
        const nextIndex = (safeIndex + direction + items.length) % items.length;
        this.selectedIndex.set(nextIndex);
    }

    private selectCurrent(): void {
        const items = this.flatCommands();
        if (items.length === 0) {
            return;
        }

        const index = this.selectedIndex();
        if (index < 0 || index >= items.length) {
            return;
        }

        this.onCommandClick(items[index]);
    }

    getScopeTitleKey(scope: WorkspaceCommandScope): string {
        if (scope === 'global') {
            return 'WORKSPACE.COMMAND_PALETTE.GROUP_GLOBAL';
        }
        if (scope === 'playlist') {
            return 'WORKSPACE.COMMAND_PALETTE.GROUP_PLAYLIST';
        }
        return 'WORKSPACE.COMMAND_PALETTE.GROUP_SECTION';
    }

    getCommandIcon(command: WorkspaceCommandItem): string {
        switch (command.id) {
            case 'global-search':
                return 'search';
            case 'playlist-search':
                return 'playlist_play';
            case 'open-global-favorites':
                return 'star';
            case 'open-downloads':
                return 'download';
            case 'open-global-recent':
                return 'history';
            case 'open-settings':
                return 'settings';
            case 'open-sources':
                return 'library_books';
            case 'open-dashboard':
                return 'dashboard';
            case 'add-playlist':
                return 'add_circle_outline';
            case 'refresh-playlist':
                return 'sync';
            case 'playlist-info':
                return 'info';
            case 'account-info':
                return 'account_circle';
            case 'go-to-vod':
                return 'movie';
            case 'go-to-live':
                return 'live_tv';
            case 'go-to-series':
                return 'video_library';
            default:
                return 'bolt';
        }
    }
}

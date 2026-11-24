import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    computed,
    effect,
    inject,
    signal,
    viewChildren,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ParentalLockService } from '@iptvnator/services';
import type { ServerProfile } from '@iptvnator/shared/interfaces/profiles';
import { StateViewComponent } from '@iptvnator/ui/state';
import { ProfilesRuntime } from '../services/profiles-runtime';
import { ProfileAvatarComponent } from './profile-avatar.component';
import { markProfilePicked, sanitizeReturnUrl } from './profile-picker-route';
import { ProfilePinDialogComponent } from './profile-pin-dialog.component';

type Direction = 'left' | 'right' | 'up' | 'down' | 'first' | 'last';

const KEY_DIRECTION: Readonly<Record<string, Direction>> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    Home: 'first',
    End: 'last',
};

/**
 * "Who's watching?": one button per profile. Reached only through the
 * workspace guard. Arrow keys (and the Android TV D-pad) move through the
 * grid, Enter or OK picks, and a PIN profile asks for its PIN first.
 */
@Component({
    selector: 'app-profile-picker',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './profile-picker.component.html',
    styleUrl: './profile-picker.component.scss',
    imports: [
        MatIconModule,
        ProfileAvatarComponent,
        RouterLink,
        StateViewComponent,
        TranslatePipe,
    ],
})
export class ProfilePickerComponent {
    private readonly runtime = inject(ProfilesRuntime);
    private readonly router = inject(Router);
    private readonly dialog = inject(MatDialog);
    private readonly parentalLock = inject(ParentalLockService);
    private readonly returnUrl = sanitizeReturnUrl(
        inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl')
    );
    private readonly tiles =
        viewChildren<ElementRef<HTMLButtonElement>>('tile');
    private focused = false;

    readonly profiles = computed<readonly ServerProfile[]>(
        () => this.runtime.list()?.profiles ?? []
    );
    readonly activeId = this.runtime.activeId;
    readonly loading = computed(
        () => !this.runtime.list() && this.runtime.state() !== 'offline'
    );
    readonly failed = computed(
        () => !this.runtime.list() && this.runtime.state() === 'offline'
    );
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);

    constructor() {
        void this.runtime.refresh();
        effect(() => {
            const tiles = this.tiles();
            if (this.focused || tiles.length === 0) return;
            this.focused = true;
            const index = this.profiles().findIndex(
                (profile) => profile.id === this.activeId()
            );
            tiles[Math.max(0, index)].nativeElement.focus();
        });
    }

    /** Opening settings from here is an answer too: the guard must not bounce back. */
    markPicked = markProfilePicked;

    retry(): void {
        void this.runtime.refresh();
    }

    /** No answer from the server: carry on as Default. */
    continueAsDefault(): void {
        markProfilePicked();
        void this.router.navigateByUrl(this.returnUrl);
    }

    onKeydown(event: KeyboardEvent, index: number): void {
        const direction = KEY_DIRECTION[event.key];
        if (!direction || event.altKey || event.ctrlKey || event.metaKey)
            return;
        const target = this.neighbour(index, direction);
        if (target === null) return; // let the TV layer or the page take it
        event.preventDefault();
        this.tiles()[target].nativeElement.focus();
    }

    async choose(profile: ServerProfile): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        this.error.set(null);
        try {
            const current = this.runtime.active();
            if (
                current?.kids &&
                current.id !== profile.id &&
                !(await this.parentalLock.requestUnlock({
                    titleKey: 'PROFILES.PICKER.LEAVE_KIDS_TITLE',
                    descriptionKey: 'PROFILES.PICKER.LEAVE_KIDS_DESCRIPTION',
                }))
            )
                return;
            if (profile.hasPin && !(await this.askPin(profile))) return;
            if (!this.runtime.select(profile.id)) {
                this.error.set('PROFILES.ERRORS.GENERIC');
                return;
            }
            markProfilePicked();
            await this.router.navigateByUrl(this.returnUrl);
        } finally {
            this.busy.set(false);
        }
    }

    private async askPin(profile: ServerProfile): Promise<boolean> {
        const ref = ProfilePinDialogComponent.open(this.dialog, {
            titleKey: 'PROFILES.PIN_DIALOG.UNLOCK_TITLE',
            titleParams: { name: profile.name },
            descriptionKey: 'PROFILES.PIN_DIALOG.UNLOCK_DESCRIPTION',
            submitKey: 'PROFILES.PIN_DIALOG.UNLOCK',
            submit: async (pin) => {
                const result = await this.runtime
                    .client()
                    .unlock(profile.id, pin);
                if (!result.ok)
                    this.runtime.handleProfileError(result.error.code);
                return result;
            },
        });
        return (await firstValueFrom(ref.afterClosed())) === true;
    }

    /** The tile in `direction` from `index`, or null at the edge of the grid. */
    private neighbour(index: number, direction: Direction): number | null {
        const tiles = this.tiles().map((tile) => tile.nativeElement);
        const last = tiles.length - 1;
        const columns = Math.max(
            1,
            tiles.filter((tile) => tile.offsetTop === tiles[0].offsetTop).length
        );
        const next = {
            left: index % columns === 0 ? -1 : index - 1,
            right: index % columns === columns - 1 ? -1 : index + 1,
            up: index - columns,
            down: index + columns,
            first: 0,
            last,
        }[direction];
        return next < 0 || next > last || next === index ? null : next;
    }
}

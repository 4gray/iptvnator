import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialog,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import {
    isValidParentalLockPin,
    PARENTAL_LOCK_PIN_MAX_LENGTH,
    PARENTAL_LOCK_PIN_MIN_LENGTH,
    THEME_ACCENTS,
} from '@iptvnator/shared/interfaces';
import {
    DEFAULT_PROFILE_ID,
    PROFILE_NAME_MAX_LENGTH,
    type ServerProfile,
} from '@iptvnator/shared/interfaces/profiles';
import { ImeInputDirective } from '@iptvnator/ui/components';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import {
    DialogFooterDirective,
    DialogShellComponent,
} from '@iptvnator/ui/dialog';
import { dialogSize } from '@iptvnator/ui/dialog/dialog-size';
import { isSingleEmoji } from '../profiles/profile-appearance';
import { ProfileAvatarComponent } from '../profiles/profile-avatar.component';

export interface SettingsProfileDialogData {
    /** Absent when adding. */
    readonly profile?: ServerProfile;
    /** The colour a new profile starts with. */
    readonly suggestedColour: string;
}

/** What the form decided; `pin` undefined = unchanged, null = remove. */
export interface SettingsProfileFormResult {
    readonly name: string;
    readonly colour: string;
    /** `null` removes the emoji. */
    readonly emoji: string | null;
    readonly kids: boolean;
    readonly pin: string | null | undefined;
}

type FieldError = 'name' | 'emoji' | 'pin';

/** The add and edit form of one profile. Talks to no server: the caller saves. */
@Component({
    selector: 'app-settings-profile-dialog',
    providers: [provideFormFieldDefaults()],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './settings-profile-dialog.component.html',
    styleUrl: './settings-profile-dialog.component.scss',
    imports: [
        DialogFooterDirective,
        DialogShellComponent,
        FormsModule,
        ImeInputDirective,
        MatButtonModule,
        MatCheckboxModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        ProfileAvatarComponent,
        TranslatePipe,
    ],
})
export class SettingsProfileDialogComponent {
    readonly data = inject<SettingsProfileDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject(
        MatDialogRef<SettingsProfileDialogComponent, SettingsProfileFormResult>
    );
    private readonly imeInput = viewChild(ImeInputDirective);

    readonly existing = this.data.profile;
    readonly isDefault = this.existing?.id === DEFAULT_PROFILE_ID;
    readonly nameMax = PROFILE_NAME_MAX_LENGTH;
    readonly pinMin = PARENTAL_LOCK_PIN_MIN_LENGTH;
    readonly pinMax = PARENTAL_LOCK_PIN_MAX_LENGTH;
    readonly swatches = THEME_ACCENTS.map((accent) => ({
        id: accent.id,
        hex: accent.hex,
        labelKey: `THEMES.ACCENT_${accent.id.toUpperCase()}`,
    }));

    readonly name = signal(this.existing?.name ?? '');
    readonly colour = signal(
        this.existing?.colour ?? this.data.suggestedColour
    );
    readonly emoji = signal(this.existing?.emoji ?? '');
    readonly kids = signal(this.existing?.kids ?? false);
    readonly pin = signal('');
    readonly removePin = signal(false);
    readonly refused = signal<FieldError | null>(null);

    readonly hasPin = this.existing?.hasPin ?? false;
    readonly trimmedName = computed(() => this.name().trim());
    readonly pinDisabled = computed(() => this.kids());
    readonly showRemovePin = this.hasPin;

    onNameEnter(event: Event): void {
        if (this.imeInput()?.isCompositionKey(event)) event.preventDefault();
    }

    onPinInput(value: string): void {
        this.pin.set(value.replace(/\D/g, '').slice(0, this.pinMax));
        if (this.pin()) this.removePin.set(false);
        this.clearRefusal('pin');
    }

    setKids(checked: boolean): void {
        this.kids.set(checked);
        if (checked) {
            this.pin.set('');
            this.removePin.set(false);
        }
    }

    setRemovePin(checked: boolean): void {
        this.removePin.set(checked);
        if (checked) this.pin.set('');
    }

    clearRefusal(field: FieldError): void {
        if (this.refused() === field) this.refused.set(null);
    }

    static open(
        dialog: MatDialog,
        data: SettingsProfileDialogData
    ): MatDialogRef<
        SettingsProfileDialogComponent,
        SettingsProfileFormResult | undefined
    > {
        return dialog.open(SettingsProfileDialogComponent, {
            ...dialogSize('md'),
            data,
            autoFocus: 'input',
            restoreFocus: true,
        });
    }

    save(): void {
        const name = this.trimmedName();
        const emoji = this.emoji().trim();
        const pin = this.pin();
        if (!name || name.length > this.nameMax) return this.refuse('name');
        if (emoji && !isSingleEmoji(emoji)) return this.refuse('emoji');
        if (pin && !isValidParentalLockPin(pin)) return this.refuse('pin');
        this.dialogRef.close({
            name,
            colour: this.colour(),
            emoji: emoji || null,
            kids: this.kids(),
            pin: this.kids()
                ? this.hasPin
                    ? null
                    : undefined
                : this.removePin()
                  ? null
                  : pin || undefined,
        });
    }

    cancel(): void {
        this.dialogRef.close(undefined);
    }

    private refuse(field: FieldError): void {
        this.refused.set(field);
    }
}

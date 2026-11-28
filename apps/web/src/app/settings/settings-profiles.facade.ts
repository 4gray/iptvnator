import { Injectable, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ParentalLockService } from '@iptvnator/services';
import type {
    ProfilesError,
    ProfilesResult,
} from '@iptvnator/services/profiles';
import {
    DEFAULT_PROFILE_ID,
    PROFILE_LIMIT,
    type CreateServerProfileRequest,
    type ServerProfile,
    type UpdateServerProfileRequest,
} from '@iptvnator/shared/interfaces/profiles';
import { DialogService } from '@iptvnator/ui/components/confirm-dialog';
import { PROFILE_SWATCHES } from '../profiles/profile-appearance';
import {
    profileErrorMessage,
    type ProfileErrorMessage,
} from '../profiles/profile-error-message';
import { ProfilePinDialogComponent } from '../profiles/profile-pin-dialog.component';
import type { ProfilesRuntime } from '../services/profiles-runtime';
import {
    writeProfilesStart,
    type ProfilesStartPreference,
} from '../services/profiles-preferences';
import {
    SettingsProfileDialogComponent,
    type SettingsProfileDialogData,
    type SettingsProfileFormResult,
} from './settings-profile-dialog.component';

/**
 * Every action of Settings → Profiles. Each one acts at once (no save bar),
 * asks the server through the runtime's client, then refreshes the runtime so
 * the list shows what the server holds. PINs go from a dialog to the client
 * and nowhere else: never to a signal, a log or an error text.
 */
@Injectable()
export class SettingsProfilesFacade {
    private readonly dialog = inject(MatDialog);
    private readonly confirm = inject(DialogService);
    private readonly translate = inject(TranslateService);
    private readonly parentalLock = inject(ParentalLockService);
    private runtime!: ProfilesRuntime;

    readonly busy = signal(false);
    readonly error = signal<ProfileErrorMessage | null>(null);

    attach(runtime: ProfilesRuntime): void {
        this.runtime = runtime;
    }

    canAdd(): boolean {
        return (this.runtime.list()?.profiles.length ?? 0) < PROFILE_LIMIT;
    }

    setStart(instanceId: string | undefined, value: ProfilesStartPreference) {
        writeProfilesStart(instanceId, value);
    }

    setEnabled(enabled: boolean): Promise<void> {
        return this.run(() => this.runtime.client().setEnabled(enabled));
    }

    async add(): Promise<void> {
        const taken = new Set(
            this.runtime.list()?.profiles.map((profile) => profile.colour)
        );
        await this.askForm(undefined, taken, async (form) => {
            await this.verified();
            const request: CreateServerProfileRequest = {
                name: form.name,
                colour: form.colour,
                ...(form.emoji ? { emoji: form.emoji } : {}),
                ...(form.kids ? { kids: true } : {}),
                ...(typeof form.pin === 'string' ? { pin: form.pin } : {}),
            };
            return this.outcome(await this.runtime.client().create(request));
        });
    }

    async edit(profile: ServerProfile): Promise<void> {
        await this.askForm(profile, new Set(), async (form) => {
            await this.verified();
            const changes = this.changesOf(profile, form);
            if (!changes) return null;
            // Parental PIN first: an adult profile in a kids' hands must not
            // lose its kids flag by a plain click.
            if (
                profile.kids &&
                changes.kids === false &&
                !(await this.unlock())
            )
                return 'cancelled';
            if (!(profile.hasPin && changes.pin !== undefined)) {
                const result = await this.runtime
                    .client()
                    .update(profile.id, changes);
                // Another device set a PIN since this list loaded: ask for it now.
                if (result.ok || result.error.code !== 'pin_required')
                    return this.outcome(result, profile.id);
            }
            const failure: { error: ProfilesError | null } = { error: null };
            const done = await this.askPin(
                profile,
                'SETTINGS.PROFILES.PIN_CHANGE_TITLE',
                'SETTINGS.PROFILES.PIN_CHANGE_DESCRIPTION',
                'SETTINGS.PROFILES.SAVE',
                async (currentPin) => {
                    const result = await this.runtime
                        .client()
                        .update(profile.id, { ...changes, currentPin });
                    if (!result.ok) failure.error = result.error;
                    return result;
                }
            );
            return done ? null : (failure.error ?? 'cancelled');
        });
    }

    async remove(profile: ServerProfile): Promise<void> {
        if (profile.id === DEFAULT_PROFILE_ID) return;
        if (profile.kids && !(await this.unlock())) return;
        if (profile.hasPin) {
            const done = await this.askPin(
                profile,
                'SETTINGS.PROFILES.DELETE_TITLE',
                'SETTINGS.PROFILES.DELETE_PIN_DESCRIPTION',
                'SETTINGS.PROFILES.DELETE',
                (pin) => this.runtime.client().remove(profile.id, pin)
            );
            if (done) await this.settle();
            return;
        }
        void this.confirm.openConfirmDialog({
            title: this.translate.instant('SETTINGS.PROFILES.DELETE_TITLE', {
                name: profile.name,
            }),
            subtitle: profile.name,
            message: this.translate.instant(
                'SETTINGS.PROFILES.DELETE_MESSAGE',
                { name: profile.name }
            ),
            confirmLabel: this.translate.instant('SETTINGS.PROFILES.DELETE'),
            tone: 'destructive',
            onConfirm: () =>
                void this.run(
                    () => this.runtime.client().remove(profile.id),
                    profile.id
                ),
        });
    }

    /** Moves one profile among the non-default ones; Default stays first. */
    async move(profile: ServerProfile, delta: -1 | 1): Promise<void> {
        const ids = (this.runtime.list()?.profiles ?? []).map((p) => p.id);
        const index = ids.indexOf(profile.id);
        const target = index + delta;
        if (index < 1 || target < 1 || target >= ids.length) return;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        await this.run(() => this.runtime.client().reorder(ids));
    }

    private changesOf(
        profile: ServerProfile,
        form: SettingsProfileFormResult
    ): UpdateServerProfileRequest | null {
        const changes: {
            -readonly [
                K in keyof UpdateServerProfileRequest
            ]: UpdateServerProfileRequest[K];
        } = {};
        if (form.name !== profile.name) changes.name = form.name;
        if (form.colour !== profile.colour) changes.colour = form.colour;
        if (form.emoji !== (profile.emoji ?? null)) changes.emoji = form.emoji;
        if (form.kids !== profile.kids) changes.kids = form.kids;
        if (form.pin !== undefined && (form.pin !== null || profile.hasPin))
            changes.pin = form.pin;
        return Object.keys(changes).length > 0 ? changes : null;
    }

    /** Opens the form; it stays open on a failed save and refreshes on success. */
    private async askForm(
        profile: ServerProfile | undefined,
        takenColours: ReadonlySet<string>,
        submit: SettingsProfileDialogData['submit']
    ): Promise<void> {
        const suggestedColour = (
            PROFILE_SWATCHES.find(({ hex }) => !takenColours.has(hex)) ??
            PROFILE_SWATCHES[0]
        ).hex;
        const ref = SettingsProfileDialogComponent.open(this.dialog, {
            profile,
            suggestedColour,
            submit,
        });
        if ((await firstValueFrom(ref.afterClosed())) === true)
            await this.settle();
    }

    /** A failed request clears the browser's server check: redo it before the next write. */
    private offlineBefore = false;

    private async verified(): Promise<void> {
        if (!this.offlineBefore) return;
        this.offlineBefore = false;
        await this.runtime.recheck();
    }

    private outcome(
        result: ProfilesResult<unknown>,
        profileId?: string
    ): ProfilesError | null {
        if (result.ok) return null;
        if (result.error.code === 'offline') this.offlineBefore = true;
        this.runtime.handleProfileError(result.error.code, profileId);
        return result.error;
    }

    private async askPin(
        profile: ServerProfile,
        titleKey: string,
        descriptionKey: string,
        submitKey: string,
        send: (pin: string) => Promise<ProfilesResult<unknown>>
    ): Promise<boolean> {
        const ref = ProfilePinDialogComponent.open(this.dialog, {
            titleKey,
            titleParams: { name: profile.name },
            descriptionKey,
            submitKey,
            submit: async (pin) => {
                await this.verified();
                const result = await send(pin);
                if (!result.ok && result.error.code === 'offline')
                    this.offlineBefore = true;
                if (!result.ok)
                    this.runtime.handleProfileError(
                        result.error.code,
                        profile.id
                    );
                return result;
            },
        });
        return (await firstValueFrom(ref.afterClosed())) === true;
    }

    private unlock(): Promise<boolean> {
        return this.parentalLock.confirmPin({
            titleKey: 'SETTINGS.PROFILES.PARENTAL_TITLE',
            descriptionKey: 'SETTINGS.PROFILES.PARENTAL_DESCRIPTION',
        });
    }

    private async run(
        operation: () => Promise<ProfilesResult<unknown>>,
        profileId?: string
    ): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        this.error.set(null);
        try {
            await this.verified();
            const result = await operation();
            if (result.ok) await this.settle();
            else await this.fail(result.error, profileId);
        } finally {
            this.busy.set(false);
        }
    }

    private async fail(
        error: ProfilesError,
        profileId?: string
    ): Promise<void> {
        this.error.set(profileErrorMessage(error));
        if (error.code === 'offline') this.offlineBefore = true;
        this.runtime.handleProfileError(error.code, profileId);
        // A changed list (another device, a stale order) shows as it is now.
        await this.runtime.refresh();
    }

    /** The runtime does not refresh after a mutation: wait out any refresh that began before it, then ask afresh. */
    private async settle(): Promise<void> {
        await this.runtime.idle();
        await this.runtime.refresh();
    }
}

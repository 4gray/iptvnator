import { Component, inject, output, signal } from '@angular/core';
import {
    FormControl,
    FormGroup,
    FormsModule,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    asStalkerPortalError,
    legacyTransformStalkerPortalUrl,
    normalizeStalkerPortalInputUrl,
    STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS,
    StalkerPortalDiscoveryService,
    normalizeStalkerPortalIdentity,
    stalkerSessionFingerprint,
} from '@iptvnator/portal/stalker/data-access';
import {
    createRandomId,
    deriveStalkerDeviceIdsFromMac,
    hasInfomirMacOui,
    isFullStalkerPortalUrl,
    normalizeStalkerMacAddress,
    Playlist,
    validateStalkerMacAddressControl,
} from '@iptvnator/shared/interfaces';
import {
    STALKER_IMPORT_ERROR_KEY_BY_KIND,
    toStalkerPlaylistIdentityFields,
} from './stalker-import-identity';

@Component({
    imports: [
        FormsModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatInputModule,
        ReactiveFormsModule,
        TranslatePipe,
    ],
    selector: 'app-stalker-portal-import',
    templateUrl: './stalker-portal-import.component.html',
    styles: [
        `
            :host {
                display: flex;
                margin: 10px;
                justify-content: center;
            }

            form {
                width: 100%;
            }

            .loading-container {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .derive-device-ids {
                margin: 4px 0 12px;
            }

            .derive-device-ids__note {
                margin: 4px 0 0;
                color: var(--mat-sys-on-surface-variant);
                font-size: 12px;
                line-height: 1.45;
            }
        `,
    ],
})
export class StalkerPortalImportComponent {
    readonly addClicked = output<void>();
    readonly URL_REGEX = /^(http|https|file):\/\/[^ "]+$/;

    readonly form = new FormGroup({
        _id: new FormControl(createRandomId()),
        title: new FormControl('', [Validators.required]),
        macAddress: new FormControl('', [
            Validators.required,
            validateStalkerMacAddressControl,
        ]),
        serialNumber: new FormControl(''),
        deviceId1: new FormControl(''),
        deviceId2: new FormControl(''),
        signature1: new FormControl(''),
        signature2: new FormControl(''),
        password: new FormControl(''),
        username: new FormControl(''),
        portalUrl: new FormControl('', [
            Validators.required,
            Validators.pattern(this.URL_REGEX),
        ]),
        importDate: new FormControl(new Date().toISOString()),
        userAgent: new FormControl(''),
    });

    private readonly portalDiscovery = inject(StalkerPortalDiscoveryService);
    private readonly store = inject(Store);
    private readonly snackBar = inject(MatSnackBar);
    readonly translate = inject(TranslateService);

    readonly isLoading = signal(false);

    /** Whether the device IDs are being generated from the MAC. */
    readonly derivesDeviceIds = signal(false);

    /** Stamps each derivation so a late one cannot overwrite a newer one. */
    private deriveGeneration = 0;

    /**
     * A MAC outside Infomir's range is imported anyway — plenty of resellers
     * disable the check — but the stock portal answers a bare `{status: 1}`
     * for it, so the hint has to say where that dead end comes from.
     */
    get showsForeignOuiHint(): boolean {
        const value = this.form.controls.macAddress.value;
        return Boolean(normalizeStalkerMacAddress(value)) &&
            !hasInfomirMacOui(value);
    }

    /**
     * The toggle is unavailable while an import is running, and while
     * derivation would overwrite a device ID the user entered by hand.
     *
     * Locking it during the import is not cosmetic. `addPlaylist()` snapshots
     * the identity and then hands it to portal discovery, which authenticates
     * with it — so by the time a slow discovery returns, the portal has
     * already pinned those IDs to the MAC. The snapshot is therefore the only
     * correct thing to persist, and unticking mid-flight cannot change that.
     * Leaving the box live would show the fields emptying and imply the
     * opposite.
     */
    get hasManualDeviceIds(): boolean {
        if (this.isLoading()) {
            return true;
        }

        return (
            !this.derivesDeviceIds() &&
            Boolean(
                this.form.controls.deviceId1.value ||
                    this.form.controls.deviceId2.value
            )
        );
    }

    /**
     * Rewrites what the user typed into the canonical `00:1A:79:…` form on
     * blur. Only input is normalized: the field shows the exact bytes that
     * will go into the `mac` cookie, so the change is visible and editable
     * rather than something the transport does silently later.
     */
    async onMacAddressBlur(): Promise<void> {
        await this.settleMacAddressIdentity();
    }

    /**
     * Brings the MAC field and the derived device IDs into agreement, and
     * resolves only once they are.
     *
     * Both the blur handler and the submit path go through here. Submitting
     * has to re-run it rather than trust the blur: clicking Add moves focus
     * out of the field, so the blur's `SHA256` is still in flight when Angular
     * invokes the click handler — and a form read at that moment pairs the
     * corrected MAC with the PREVIOUS MAC's device IDs (or with empty ones).
     * The portal pins whatever pair it first receives to that MAC
     * permanently, so there is no recovering from it afterwards. Re-running
     * also covers the case where no blur fired at all.
     */
    private async settleMacAddressIdentity(): Promise<void> {
        const control = this.form.controls.macAddress;
        const normalized = normalizeStalkerMacAddress(control.value);

        if (normalized && normalized !== control.value) {
            control.setValue(normalized);
        }

        // Re-derive while the box is ticked: nothing is pinned until the
        // import actually runs, so correcting a typo must correct the ID it
        // would otherwise bind the account to forever.
        await this.applyDerivedDeviceIds();
    }

    /**
     * Fills both device ID fields with the StbEmu / stalker-to-m3u pair
     * (`SHA256(MAC)` and `SHA256(MAC + "stalker")`, which a real box never
     * reports as equal) — or empties them again.
     *
     * The derived values are written into the visible fields and persisted as
     * literal strings, never recomputed at request time. `device_id` is pinned
     * to the MAC by the portal on first use: a value that silently followed a
     * later MAC edit would be refused as a device conflict, and one that
     * silently disappeared would lock the account out for good.
     */
    async toggleDeriveDeviceIds(enabled: boolean): Promise<void> {
        this.derivesDeviceIds.set(enabled);
        const { deviceId1, deviceId2 } = this.form.controls;

        if (!enabled) {
            // Turning it off has to invalidate work already in flight, or the
            // digest started a moment ago lands afterwards and writes the IDs
            // straight back into the fields the user just opted out of —
            // which then reach the portal and get pinned permanently.
            this.invalidatePendingDerivation();
            deviceId1.enable();
            deviceId2.enable();
            this.form.patchValue({ deviceId1: '', deviceId2: '' });
            return;
        }

        deviceId1.disable();
        deviceId2.disable();
        await this.applyDerivedDeviceIds();
    }

    /**
     * Makes every derivation currently in flight a no-op.
     *
     * `applyDerivedDeviceIds` can only check the toggle before it awaits, so
     * anything that stops the user from wanting derived IDs — unticking the
     * box, clearing the form — has to invalidate the outstanding digest here
     * as well. Otherwise it resolves into fields that were deliberately
     * emptied, and the portal pins whatever the import then sends.
     */
    private invalidatePendingDerivation(): void {
        this.deriveGeneration += 1;
    }

    private async applyDerivedDeviceIds(): Promise<void> {
        if (!this.derivesDeviceIds()) {
            return;
        }

        // Two edits in quick succession leave two digests in flight, and
        // nothing guarantees they resolve in the order they were started. The
        // generation stamp discards every completion but the newest, so the
        // fields can never end up holding an older MAC's IDs.
        const generation = ++this.deriveGeneration;
        const derived = await deriveStalkerDeviceIdsFromMac(
            this.form.controls.macAddress.value
        );

        if (generation !== this.deriveGeneration) {
            return;
        }

        this.form.patchValue({
            deviceId1: derived?.deviceId1 ?? '',
            deviceId2: derived?.deviceId2 ?? '',
        });
    }

    clearForm(): void {
        // Same hazard as unticking the box: a digest still in flight would
        // resolve into the freshly cleared form.
        this.invalidatePendingDerivation();
        this.derivesDeviceIds.set(false);
        this.form.controls.deviceId1.enable();
        this.form.controls.deviceId2.enable();
        this.form.reset({
            _id: createRandomId(),
            title: '',
            macAddress: '',
            serialNumber: '',
            deviceId1: '',
            deviceId2: '',
            signature1: '',
            signature2: '',
            password: '',
            username: '',
            portalUrl: '',
            importDate: new Date().toISOString(),
            userAgent: '',
        });
    }

    async addPlaylist() {
        if (!this.form.valid || this.isLoading()) {
            return;
        }

        this.isLoading.set(true);

        try {
            // Before anything reads the form: clicking Add blurs the MAC
            // field, so a derivation may still be in flight, and the pairing
            // this snapshot produces is the one the portal pins forever.
            await this.settleMacAddressIdentity();

            // This snapshot is authoritative for the rest of the import, and
            // deliberately so: discovery below authenticates with exactly
            // these values, and `get_profile` is what makes the portal pin
            // them to the MAC. Re-reading the form after discovery — to pick
            // up an edit made while it was running — would persist device IDs
            // that differ from the ones already pinned, or none at all, and
            // sending nothing after a value was pinned is the permanent
            // lockout. The identity controls are locked while `isLoading()`
            // so the UI cannot suggest otherwise.
            const formValue = this.form.getRawValue();
            const originalUrl = formValue.portalUrl ?? '';
            // `getRawValue()` also carries the device ID controls while they
            // are disabled by the derivation toggle — the derived value must
            // reach the playlist.
            //
            // The validator already refused anything unparseable, so this only
            // covers the submit-without-blur path; `??` keeps a hypothetical
            // gap from silently sending the raw string instead.
            const macAddress =
                normalizeStalkerMacAddress(formValue.macAddress) ?? '';
            const stalkerIdentity = normalizeStalkerPortalIdentity({
                serialNumber: formValue.serialNumber ?? undefined,
                deviceId1: formValue.deviceId1 ?? undefined,
                deviceId2: formValue.deviceId2 ?? undefined,
                signature1: formValue.signature1 ?? undefined,
                signature2: formValue.signature2 ?? undefined,
            });

            // Probe candidate endpoints and classify the portal by observed
            // behavior (does it enforce the handshake token?) instead of
            // guessing from the URL shape — the guess persisted broken
            // configurations for canonical `…/server/load.php` portals and
            // rewrote `…/c` to a `portal.php` official Ministra never serves.
            const discovery = await this.portalDiscovery.discover(
                originalUrl,
                macAddress,
                stalkerIdentity,
                {
                    credentials: {
                        username: formValue.username ?? '',
                        password: formValue.password ?? '',
                    },
                }
            );

            let portalUrl: string;
            let isFullStalkerPortal: boolean;
            let stalkerToken: string | undefined;
            let stalkerAccountInfo: Playlist['stalkerAccountInfo'] | undefined;
            // The import profile is the only get_profile some portals ever
            // see: later starts reuse the token and skip it, so the cadence
            // it advertises has to be persisted here or the watchdog would
            // stay on the 120 s default forever. Effective values, so stored
            // absence keeps meaning "never profiled".
            let stalkerWatchdogTimeout: number | undefined;
            let stalkerTimeslot: number | undefined;

            if (discovery.status === 'resolved') {
                portalUrl = discovery.portalUrl;
                isFullStalkerPortal = discovery.isFullStalkerPortal;
                stalkerToken = discovery.token;
                if (stalkerToken) {
                    stalkerWatchdogTimeout =
                        discovery.watchdogTimeoutSeconds ??
                        STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS;
                    stalkerTimeslot = discovery.timeslotSeconds ?? 0;
                }

                if (discovery.accountInfo) {
                    stalkerAccountInfo = {
                        login: discovery.accountInfo.login,
                        expireDate: discovery.accountInfo.expire_date,
                        tariffPlanName:
                            discovery.accountInfo.tariff_plan_name,
                        status: discovery.accountInfo.status,
                    };
                }

                if (stalkerAccountInfo?.expireDate) {
                    const expireDate = new Date(
                        stalkerAccountInfo.expireDate * 1000
                    );
                    this.snackBar.open(
                        `Portal validated. Expires: ${expireDate.toLocaleDateString()}`,
                        undefined,
                        { duration: 3000 }
                    );
                }
            } else if (discovery.status === 'auth-rejected') {
                console.error(
                    '[StalkerImport] Authentication failed:',
                    discovery.error
                );
                // The portal explains its own refusals — a demanded login, a
                // rejected one, a device conflict — so relay those words
                // instead of the generic "check URL and MAC".
                this.snackBar.open(
                    this.buildAuthErrorMessage(discovery.error),
                    undefined,
                    { duration: 8000 }
                );
                return;
            } else if (
                isFullStalkerPortalUrl(
                    normalizeStalkerPortalInputUrl(originalUrl) ?? originalUrl
                )
            ) {
                // Unreachable host on a canonical-portal URL shape: the old
                // flow aborted here too (its mandatory handshake could not
                // succeed either).
                this.snackBar.open(
                    'Failed to authenticate with portal. Please check URL and MAC address.',
                    undefined,
                    { duration: 5000 }
                );
                return;
            } else {
                // Unreachable host on a panel-style URL: import with the
                // legacy guess exactly like before discovery existed, so a
                // temporarily offline panel can still be added. The lazy
                // portal repair re-probes on the first real failure.
                // Normalized first: the legacy suffix rewrites run on the
                // path, so a query/fragment must not hide a trailing `/c`.
                portalUrl = legacyTransformStalkerPortalUrl(
                    normalizeStalkerPortalInputUrl(originalUrl) ?? originalUrl
                );
                isFullStalkerPortal = false;
                this.snackBar.open(
                    'Portal did not respond; added without validation.',
                    undefined,
                    { duration: 5000 }
                );
            }

            const {
                serialNumber: _serialNumber,
                deviceId1: _deviceId1,
                deviceId2: _deviceId2,
                signature1: _signature1,
                signature2: _signature2,
                ...playlistFormValue
            } = formValue;

            const playlist: Playlist = {
                ...playlistFormValue,
                // Canonical form, so the stored MAC is the one that was
                // validated against the portal a moment ago.
                macAddress,
                portalUrl,
                isFullStalkerPortal,
                stalkerToken,
                // What this token was negotiated for: endpoint, identity AND
                // credentials. Reuse is refused when any of them no longer
                // matches — and the credentials must be included here, or the
                // first runtime `ensureToken()` would compute a fingerprint
                // WITH them, mismatch this one, and throw away the session
                // the import just established.
                ...(stalkerToken
                    ? {
                          stalkerSessionIdentity: stalkerSessionFingerprint({
                              portalUrl,
                              macAddress,
                              username: formValue.username ?? '',
                              password: formValue.password ?? '',
                              ...toStalkerPlaylistIdentityFields(
                                  stalkerIdentity
                              ),
                          } as Playlist),
                      }
                    : {}),
                stalkerWatchdogTimeout,
                stalkerTimeslot,
                stalkerAccountInfo,
                ...toStalkerPlaylistIdentityFields(stalkerIdentity),
            } as Playlist;

            this.store.dispatch(PlaylistActions.addPlaylist({ playlist }));
            this.addClicked.emit();
        } finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Turns an authentication failure into a message the user can act on.
     * The portal explains refusals itself (`msg`/`block_msg`, or one of the
     * documented plain-text bodies); its own words are appended verbatim.
     */
    private buildAuthErrorMessage(error: unknown): string {
        const portalError = asStalkerPortalError(error);
        const base = this.translate.instant(
            portalError
                ? STALKER_IMPORT_ERROR_KEY_BY_KIND[portalError.kind]
                : 'HOME.STALKER_PORTAL.AUTH_FAILED'
        );

        if (portalError?.portalText) {
            const detail = this.translate.instant(
                'HOME.STALKER_PORTAL.PORTAL_MESSAGE',
                { message: portalError.portalText }
            );
            return `${base} ${detail}`;
        }

        return base;
    }
}

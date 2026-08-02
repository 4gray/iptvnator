import { Component, inject, output, signal } from '@angular/core';
import {
    FormControl,
    FormGroup,
    FormsModule,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    legacyTransformStalkerPortalUrl,
    normalizeStalkerPortalInputUrl,
    StalkerPortalDiscoveryService,
    StalkerPortalIdentity,
    normalizeStalkerPortalIdentity,
} from '@iptvnator/portal/stalker/data-access';
import {
    createRandomId,
    isFullStalkerPortalUrl,
    Playlist,
} from '@iptvnator/shared/interfaces';

@Component({
    imports: [
        FormsModule,
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
        `,
    ],
})
export class StalkerPortalImportComponent {
    readonly addClicked = output<void>();
    readonly URL_REGEX = /^(http|https|file):\/\/[^ "]+$/;

    readonly form = new FormGroup({
        _id: new FormControl(createRandomId()),
        title: new FormControl('', [Validators.required]),
        macAddress: new FormControl('', [Validators.required]),
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

    clearForm(): void {
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
            const formValue = this.form.getRawValue();
            const originalUrl = formValue.portalUrl ?? '';
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
                formValue.macAddress ?? '',
                stalkerIdentity
            );

            let portalUrl: string;
            let isFullStalkerPortal: boolean;
            let stalkerToken: string | undefined;
            let stalkerAccountInfo: Playlist['stalkerAccountInfo'] | undefined;

            if (discovery.status === 'resolved') {
                portalUrl = discovery.portalUrl;
                isFullStalkerPortal = discovery.isFullStalkerPortal;
                stalkerToken = discovery.token;

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
                this.snackBar.open(
                    'Failed to authenticate with portal. Please check URL and MAC address.',
                    undefined,
                    { duration: 5000 }
                );
                return;
            } else if (isFullStalkerPortalUrl(originalUrl)) {
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
                portalUrl,
                isFullStalkerPortal,
                stalkerToken,
                stalkerAccountInfo,
                ...this.toPlaylistIdentityFields(stalkerIdentity),
            } as Playlist;

            this.store.dispatch(PlaylistActions.addPlaylist({ playlist }));
            this.addClicked.emit();
        } finally {
            this.isLoading.set(false);
        }
    }

    private toPlaylistIdentityFields(identity: StalkerPortalIdentity): {
        stalkerSerialNumber?: string;
        stalkerDeviceId1?: string;
        stalkerDeviceId2?: string;
        stalkerSignature1?: string;
        stalkerSignature2?: string;
    } {
        return {
            ...(identity.serialNumber
                ? { stalkerSerialNumber: identity.serialNumber }
                : {}),
            ...(identity.deviceId1
                ? { stalkerDeviceId1: identity.deviceId1 }
                : {}),
            ...(identity.deviceId2
                ? { stalkerDeviceId2: identity.deviceId2 }
                : {}),
            ...(identity.signature1
                ? { stalkerSignature1: identity.signature1 }
                : {}),
            ...(identity.signature2
                ? { stalkerSignature2: identity.signature2 }
                : {}),
        };
    }

}

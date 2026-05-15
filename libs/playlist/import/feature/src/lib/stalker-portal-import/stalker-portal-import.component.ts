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
    StalkerPortalIdentity,
    StalkerSessionService,
    normalizeStalkerPortalIdentity,
} from '@iptvnator/portal/stalker/data-access';
import { Playlist } from '@iptvnator/shared/interfaces';
import { v4 as uuid } from 'uuid';

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
        _id: new FormControl(uuid()),
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

    private readonly stalkerSessionService = inject(StalkerSessionService);
    private readonly store = inject(Store);
    private readonly snackBar = inject(MatSnackBar);
    readonly translate = inject(TranslateService);

    readonly isLoading = signal(false);

    clearForm(): void {
        this.form.reset({
            _id: uuid(),
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
            const transformedUrl = this.transformPortalUrl(originalUrl);
            const isFullStalkerPortal =
                this.isFullStalkerPortalUrl(originalUrl);
            const stalkerIdentity = normalizeStalkerPortalIdentity({
                serialNumber: formValue.serialNumber,
                deviceId1: formValue.deviceId1,
                deviceId2: formValue.deviceId2,
                signature1: formValue.signature1,
                signature2: formValue.signature2,
            });

            let stalkerToken: string | undefined;
            let stalkerAccountInfo: Playlist['stalkerAccountInfo'] | undefined;

            // For full stalker portal URLs, perform handshake and get profile
            if (isFullStalkerPortal) {
                try {
                    const authResult =
                        await this.stalkerSessionService.authenticate(
                            transformedUrl,
                            formValue.macAddress ?? '',
                            stalkerIdentity
                        );

                    stalkerToken = authResult.token;

                    if (authResult.accountInfo) {
                        stalkerAccountInfo = {
                            login: authResult.accountInfo.login,
                            expireDate: authResult.accountInfo.expire_date,
                            tariffPlanName:
                                authResult.accountInfo.tariff_plan_name,
                            status: authResult.accountInfo.status,
                        };
                    }

                    // Show success notification with account info if available
                    if (stalkerAccountInfo?.expireDate) {
                        const expireDate = new Date(
                            stalkerAccountInfo.expireDate * 1000
                        );
                        this.snackBar.open(
                            `Portal validated. Expires: ${expireDate.toLocaleDateString()}`,
                            null,
                            { duration: 3000 }
                        );
                    }
                } catch (error) {
                    console.error(
                        '[StalkerImport] Authentication failed:',
                        error
                    );
                    this.snackBar.open(
                        'Failed to authenticate with portal. Please check URL and MAC address.',
                        null,
                        { duration: 5000 }
                    );
                    this.isLoading.set(false);
                    return;
                }
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
                portalUrl: transformedUrl,
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

    /**
     * Checks if the URL is a full stalker portal URL that requires handshake authentication
     * Pattern: example.com/stalker_portal/c or example.com/stalker_portal/...
     */
    isFullStalkerPortalUrl(url: string): boolean {
        return url.includes('/stalker_portal');
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

    /**
     * Transforms the portal URL to the correct API endpoint
     * - Simple URL (example.com/c) -> example.com/portal.php
     * - Full stalker portal (example.com/stalker_portal/c) -> example.com/stalker_portal/server/load.php
     */
    transformPortalUrl(url: string): string {
        // Remove trailing slashes
        url = url.replace(/\/+$/, '');

        // Case 1: Simple URL ending with /c -> convert to /portal.php
        if (url.endsWith('/c')) {
            // Check if it's a full stalker portal URL
            if (url.includes('/stalker_portal')) {
                // example.com/stalker_portal/c -> example.com/stalker_portal/server/load.php
                return url.replace(
                    /\/stalker_portal\/c$/,
                    '/stalker_portal/server/load.php'
                );
            }
            // Simple URL: example.com/c -> example.com/portal.php
            return url.replace(/\/c$/, '/portal.php');
        }

        // Case 2: Full stalker portal URL without /c at the end
        if (
            url.includes('/stalker_portal') &&
            !url.includes('/server/load.php')
        ) {
            // example.com/stalker_portal -> example.com/stalker_portal/server/load.php
            if (url.endsWith('/stalker_portal')) {
                return url + '/server/load.php';
            }
            // If it has other path segments after /stalker_portal, append server/load.php
            if (!url.endsWith('/load.php')) {
                return url.replace(
                    /\/stalker_portal(\/.*)?$/,
                    '/stalker_portal/server/load.php'
                );
            }
        }

        // Otherwise keep the provided url
        return url;
    }
}

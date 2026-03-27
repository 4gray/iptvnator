import { Component, inject, output, signal } from '@angular/core';
import {
    FormControl,
    FormGroup,
    FormsModule,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from 'm3u-state';
import {
    STALKER_SERIAL_NUMBER,
    StalkerSessionService,
} from '@iptvnator/portal/stalker/data-access';
import { Playlist } from 'shared-interfaces';
import { v4 as uuid } from 'uuid';

type ParsedPortalInput = {
    originalInput: string;
    normalizedPortalUrl: string;
    isFullStalkerPortal: boolean;
    isCustomPortal: boolean;
    customPortalKey?: string;
};

@Component({
    imports: [
        FormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatProgressSpinnerModule,
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

    readonly URL_REGEX =
        /^(portal::\[key:[^\]]+\](http|https):\/\/[^ "]+|(http|https|file):\/\/[^ "]+)$/i;

    readonly CUSTOM_PORTAL_REGEX =
        /^portal::\[key:([^\]]+)\](https?:\/\/[^ "]+)$/i;

    readonly form = new FormGroup({
        _id: new FormControl(uuid()),
        title: new FormControl('', [Validators.required]),
        macAddress: new FormControl(''),
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

    async addPlaylist() {
        if (!this.form.valid || this.isLoading()) {
            return;
        }

        this.isLoading.set(true);

        try {
            const parsedPortal = this.parsePortalInput(this.form.value.portalUrl);

            if (!parsedPortal) {
                this.snackBar.open('Invalid portal URL format.', undefined, {
                    duration: 4000,
                });
                return;
            }

            const {
                originalInput,
                normalizedPortalUrl,
                isFullStalkerPortal,
                isCustomPortal,
                customPortalKey,
            } = parsedPortal;

            const macAddress = this.form.value.macAddress?.trim() || undefined;

            if (!isCustomPortal && !macAddress) {
                this.snackBar.open(
                    'MAC address is required for stalker portals.',
                    undefined,
                    { duration: 5000 }
                );
                return;
            }

            let stalkerToken: string | undefined;
            let stalkerAccountInfo: Playlist['stalkerAccountInfo'] | undefined;
            let stalkerSerialNumber: string | undefined;
            let stalkerDeviceId1: string | undefined;
            let stalkerDeviceId2: string | undefined;
            let stalkerSignature1: string | undefined;
            let stalkerSignature2: string | undefined;

            // Authenticate only for real full stalker portals, not for custom VOD portals
            if (isFullStalkerPortal && !isCustomPortal) {
                stalkerSerialNumber =
                    this.form.value.serialNumber?.trim() ||
                    STALKER_SERIAL_NUMBER;

                stalkerDeviceId1 =
                    this.form.value.deviceId1?.trim() || undefined;
                stalkerDeviceId2 =
                    this.form.value.deviceId2?.trim() || undefined;
                stalkerSignature1 =
                    this.form.value.signature1?.trim() || undefined;
                stalkerSignature2 =
                    this.form.value.signature2?.trim() || undefined;

                try {
                    const authResult =
                        await this.stalkerSessionService.authenticate(
                            normalizedPortalUrl,
                            macAddress,
                            stalkerSerialNumber,
                            stalkerDeviceId1,
                            stalkerDeviceId2
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
                } catch (error) {
                    console.error(
                        '[StalkerImport] Authentication failed:',
                        error
                    );
                    this.snackBar.open(
                        'Failed to authenticate with portal. Please check URL and MAC address.',
                        undefined,
                        { duration: 5000 }
                    );
                    return;
                }
            }

            const playlist: Playlist = {
                ...this.form.value,
                macAddress,
                portalUrl: normalizedPortalUrl,
                isFullStalkerPortal,
                isCustomPortal,
                customPortalKey,
                customPortalOriginalUrl: originalInput,
                stalkerToken,
                stalkerAccountInfo,
                stalkerSerialNumber,
                stalkerDeviceId1,
                stalkerDeviceId2,
                stalkerSignature1,
                stalkerSignature2,
            } as Playlist;

            this.store.dispatch(PlaylistActions.addPlaylist({ playlist }));
            this.addClicked.emit();
        } finally {
            this.isLoading.set(false);
        }
    }

    parsePortalInput(value: string | null | undefined): ParsedPortalInput | null {
        const input = value?.trim();

        if (!input) {
            return null;
        }

        const customMatch = input.match(this.CUSTOM_PORTAL_REGEX);

        if (customMatch) {
            const [, customPortalKey, customPortalUrl] = customMatch;

            return {
                originalInput: input,
                normalizedPortalUrl: customPortalUrl,
                isCustomPortal: true,
                customPortalKey: customPortalKey.trim(),
                isFullStalkerPortal: false,
            };
        }

        if (!input.match(/^(http|https|file):\/\/[^ "]+$/i)) {
            return null;
        }

        return {
            originalInput: input,
            normalizedPortalUrl: this.transformPortalUrl(input),
            isCustomPortal: false,
            isFullStalkerPortal: this.isFullStalkerPortalUrl(input),
        };
    }

    /**
     * Checks if the URL is a full stalker portal URL that requires handshake authentication
     * Pattern: example.com/stalker_portal/c or example.com/stalker_portal/...
     */
    isFullStalkerPortalUrl(url: string): boolean {
        return url.includes('/stalker_portal');
    }

    /**
     * Transforms the portal URL to the correct API endpoint
     * - Simple URL (example.com/c) -> example.com/portal.php
     * - Full stalker portal (example.com/stalker_portal/c) -> example.com/stalker_portal/server/load.php
     */
    transformPortalUrl(url: string): string {
        url = url.replace(/\/+$/, '');

        if (url.endsWith('/c')) {
            if (url.includes('/stalker_portal')) {
                return url.replace(
                    /\/stalker_portal\/c$/,
                    '/stalker_portal/server/load.php'
                );
            }

            return url.replace(/\/c$/, '/portal.php');
        }

        if (
            url.includes('/stalker_portal') &&
            !url.includes('/server/load.php')
        ) {
            if (url.endsWith('/stalker_portal')) {
                return url + '/server/load.php';
            }

            if (!url.endsWith('/load.php')) {
                return url.replace(
                    /\/stalker_portal(\/.*)?$/,
                    '/stalker_portal/server/load.php'
                );
            }
        }

        return url;
    }
}
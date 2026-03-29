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
    readonly URL_REGEX = /^(portal::\[key:[^\]]+\])?(http|https):\/\/[^ "\n\r]+$/;

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
        portalUrl: new FormControl('', [Validators.required]),
        importDate: new FormControl(new Date().toISOString()),
        userAgent: new FormControl(''),
    });

    private readonly stalkerSessionService = inject(StalkerSessionService);
    private readonly store = inject(Store);
    private readonly snackBar = inject(MatSnackBar);
    readonly translate = inject(TranslateService);

    readonly isLoading = signal(false);

    private extractCustomPortalInfo(url: string): {
        key?: string;
        baseUrl: string;
    } {
        const prefixPattern = /^portal::\[key:([^\]]+)\](https?:\/\/.+)$/i;
        const match = url.match(prefixPattern);
        if (match) {
            return { key: match[1], baseUrl: match[2] };
        }
        return { baseUrl: url };
    }

    async addPlaylist() {
        if (!this.form.valid || this.isLoading()) {
            return;
        }
        this.isLoading.set(true);

        try {
            const originalValue = (this.form.value.portalUrl || '').trim();
            const providedMac = (this.form.value.macAddress || '').trim();
            const safeMacAddress = providedMac
                ? providedMac
                : '00:00:00:00:00:00';
            const { key: customKey, baseUrl } = this.extractCustomPortalInfo(
                originalValue
            );
            const transformedUrl = this.transformPortalUrl(baseUrl);
            const isFullStalkerPortal = this.isFullStalkerPortalUrl(baseUrl);

            let stalkerToken: string | undefined;
            let stalkerAccountInfo: Playlist['stalkerAccountInfo'] | undefined;
            let stalkerSerialNumber: string | undefined;
            let stalkerDeviceId1: string | undefined;
            let stalkerDeviceId2: string | undefined;
            let stalkerSignature1: string | undefined;
            let stalkerSignature2: string | undefined;

            if (isFullStalkerPortal) {
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
                    const authResult = await this.stalkerSessionService.authenticate(
                        transformedUrl,
                        safeMacAddress,
                        stalkerSerialNumber,
                        stalkerDeviceId1,
                        stalkerDeviceId2
                    );
                    stalkerToken = authResult.token;
                    if (authResult.accountInfo) {
                        stalkerAccountInfo = {
                            login: authResult.accountInfo.login,
                            expireDate: authResult.accountInfo.expire_date,
                            tariffPlanName: authResult.accountInfo.tariff_plan_name,
                            status: authResult.accountInfo.status,
                        };
                    }
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
                    console.error('[StalkerImport] Authentication failed:', error);
                    this.snackBar.open(
                        'Failed to authenticate with portal. Please check URL and MAC address.',
                        null,
                        { duration: 5000 }
                    );
                    this.isLoading.set(false);
                    return;
                }
            }

            const normalizedCustomKey = customKey?.trim();
            const nowIso = new Date().toISOString();
            const playlist = {
                ...this.form.value,
                macAddress: safeMacAddress,
                portalUrl: transformedUrl,
                isFullStalkerPortal,
                isCustomPortal: Boolean(normalizedCustomKey),
                customPortalKey: normalizedCustomKey || undefined,
                customPortalOriginalUrl: normalizedCustomKey
                    ? originalValue
                    : undefined,
                stalkerToken,
                stalkerAccountInfo,
                stalkerSerialNumber,
                stalkerDeviceId1,
                stalkerDeviceId2,
                stalkerSignature1,
                stalkerSignature2,
                importDate: this.form.value.importDate || nowIso,
                lastUsage: nowIso,
                count: 0,
                autoRefresh: false,
            } as Playlist;

            this.store.dispatch(PlaylistActions.addPlaylist({ playlist }));
            this.addClicked.emit();
        } finally {
            this.isLoading.set(false);
        }
    }

    isFullStalkerPortalUrl(url: string): boolean {
        return url.includes('/stalker_portal');
    }

    transformPortalUrl(url: string): string {
        url = url.replace(/\/+$/, '');

        if (/\/api\/v1$/i.test(url)) {
            return url;
        }

        if (url.endsWith('/c')) {
            if (url.includes('/stalker_portal')) {
                return url.replace(
                    /\/stalker_portal\/c$/,
                    '/stalker_portal/server/load.php'
                );
            }
            return url.replace(/\/c$/, '/portal.php');
        }

        if (url.includes('/stalker_portal') && !url.includes('/server/load.php')) {
            if (url.endsWith('/stalker_portal')) {
                return `${url}/server/load.php`;
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
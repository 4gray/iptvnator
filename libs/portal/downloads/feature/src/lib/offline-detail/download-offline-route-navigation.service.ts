import { Location } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { safeOfflineManagerReturnUrl } from './download-offline-detail.presentation';

@Injectable()
export class DownloadOfflineRouteNavigationService {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly location = inject(Location);

    back(): void {
        if (this.returnUrl()) {
            this.location.back();
            return;
        }
        void this.toManager(false);
    }

    async toManager(replaceUrl: boolean): Promise<void> {
        const returnUrl = this.returnUrl();
        if (returnUrl) {
            await this.router.navigateByUrl(returnUrl, { replaceUrl });
            return;
        }
        await this.router.navigate(['..'], {
            relativeTo: this.route,
            queryParamsHandling: 'preserve',
            ...(replaceUrl ? { replaceUrl: true } : {}),
        });
    }

    private returnUrl(): string | undefined {
        return safeOfflineManagerReturnUrl(
            this.location.getState(),
            this.router.url
        );
    }
}

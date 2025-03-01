import { Injectable, inject } from '@angular/core';
import { XTREAM_REQUEST } from '../../../shared/ipc-commands';
import { DataService } from './data.service';

export type PortalStatus = 'active' | 'inactive' | 'expired' | 'unavailable';

@Injectable({
    providedIn: 'root',
})
export class PortalStatusService {
    private readonly dataService = inject(DataService);

    /**
     * Checks the status of an Xtream Code portal
     *
     * @param serverUrl The base URL of the server
     * @param username The username for authentication
     * @param password The password for authentication
     * @returns A promise that resolves to the portal status
     */
    async checkPortalStatus(
        serverUrl: string,
        username: string,
        password: string
    ): Promise<PortalStatus> {
        try {
            let normalizedUrl = serverUrl;
            if (serverUrl && !serverUrl.endsWith('/')) {
                normalizedUrl = serverUrl;
            }

            let response = await this.dataService.sendIpcEvent(XTREAM_REQUEST, {
                url: normalizedUrl,
                params: {
                    password,
                    username,
                    action: 'get_account_info',
                },
            });
            response = response?.payload;

            if (!response?.user_info?.status) {
                return 'unavailable';
            }

            if (response.user_info.status === 'Active') {
                const expDate = new Date(
                    parseInt(response.user_info.exp_date) * 1000
                );
                return expDate < new Date() ? 'expired' : 'active';
            } else {
                return 'inactive';
            }
        } catch (error) {
            console.error('Error checking portal status:', error);
            return 'unavailable';
        }
    }

    /**
     * Gets a user-friendly message based on the portal status
     *
     * @param status The portal status
     * @returns A message describing the status
     */
    getStatusMessage(status: PortalStatus | null): string {
        switch (status) {
            case 'active':
                return 'Connection successful! Portal is active.';
            case 'inactive':
                return 'Portal is inactive.';
            case 'expired':
                return 'Portal subscription has expired.';
            case 'unavailable':
                return 'Could not connect to the portal.';
            default:
                return '';
        }
    }

    /**
     * Gets a CSS class name based on the portal status
     *
     * @param status The portal status
     * @returns A CSS class name
     */
    getStatusClass(status: PortalStatus | null): string {
        return status ? `status-${status}` : '';
    }

    /**
     * Gets an icon name based on the portal status
     *
     * @param status The portal status
     * @returns A material icon name
     */
    getStatusIcon(status: PortalStatus | null): string {
        switch (status) {
            case 'active':
                return 'check_circle';
            case 'inactive':
                return 'cancel';
            case 'expired':
                return 'warning';
            case 'unavailable':
            default:
                return 'error';
        }
    }
}

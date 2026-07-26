import { inject, Injectable, signal } from '@angular/core';
import { RuntimeCapabilitiesService } from '@iptvnator/services';

/**
 * Backs the remote-control section: the reachable LAN addresses and which of
 * them currently shows its pairing QR code.
 */
@Injectable()
export class SettingsRemoteControlFacade {
    private readonly runtime = inject(RuntimeCapabilitiesService);

    /** Local IP addresses for remote control URL display */
    readonly localIpAddresses = signal<string[]>([]);

    /** Currently visible QR code IP (null = none visible) */
    readonly visibleQrCodeIp = signal<string | null>(null);

    /**
     * Fetches local IP addresses for remote control URL display
     */
    async fetchLocalIpAddresses(): Promise<void> {
        if (
            this.runtime.supportsRemoteControl &&
            window.electron?.getLocalIpAddresses
        ) {
            const addresses = await window.electron.getLocalIpAddresses();
            this.localIpAddresses.set(addresses);
        }
    }

    /**
     * Toggle QR code visibility for a given IP address
     */
    toggleQrCode(ip: string): void {
        this.visibleQrCodeIp.update((visible) => (visible === ip ? null : ip));
    }
}

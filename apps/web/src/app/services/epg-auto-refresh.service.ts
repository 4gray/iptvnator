import { DestroyRef, inject, Injectable } from '@angular/core';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { EpgSourceSettingsService, SettingsStore } from '@iptvnator/services';

const LAST_REFRESH_KEY = 'iptvnator:epg-auto-refresh-at-v1';
const VALID_HOURS = [6, 12, 18, 24] as const;
const MINUTE = 60_000;

/**
 * Renderer-owned scheduler: no background daemon, no cron and no credentials
 * in storage. Settings are read afresh for every tick, so Save takes effect
 * without restarting IPTVnator. Never overlaps refresh operations.
 */
@Injectable({ providedIn: 'root' })
export class EpgAutoRefreshService {
    private readonly settings = inject(SettingsStore);
    private readonly sources = inject(EpgSourceSettingsService);
    private readonly bridge = inject(EpgRuntimeBridgeService);
    private readonly destroyRef = inject(DestroyRef);
    private ticker: ReturnType<typeof setInterval> | null = null;
    private running = false;
    private started = false;

    start(): void {
        if (this.started || !this.bridge.supportsDataManagement) return;
        this.started = true;
        this.destroyRef.onDestroy(() => {
            if (this.ticker !== null) clearInterval(this.ticker);
            this.ticker = null;
        });
        void this.settings.loadSettings().then(async () => {
            if (this.ticker !== null) return;
            // Initialize the recurring clock without forcing a download for
            // existing installations. The prior stale-on-launch path stays intact.
            if (!this.lastRefresh()) this.writeRefresh(Date.now());
            if (this.settings.epgAutoRefresh?.() !== false &&
                this.settings.epgRefreshOnStartup?.() === true) {
                await this.refreshAll();
            }
            this.ticker = setInterval(() => void this.tick(), MINUTE);
        }).catch(() => undefined);
    }

    private async tick(): Promise<void> {
        if (this.running || this.settings.epgAutoRefresh?.() === false) return;
        const configured = Number(this.settings.epgRefreshIntervalHours?.() ?? 12);
        const hours = VALID_HOURS.includes(configured as 6 | 12 | 18 | 24)
            ? configured : 12;
        if (Date.now() - this.lastRefresh() < hours * 3_600_000) return;
        await this.refreshAll();
    }

    private async refreshAll(): Promise<void> {
        if (this.running || this.settings.epgAutoRefresh?.() === false) return;
        const urls = [...new Set((this.settings.epgUrl() ?? []).map(url => url.trim()).filter(Boolean))];
        if (!urls.length) return;
        this.running = true;
        // Stamp the attempt before starting: failures must not create a
        // one-minute hammering loop against a provider returning HTTP 403/500.
        this.writeRefresh(Date.now());
        try {
            await this.sources.waitForReconciliation();
            for (const url of urls) {
                if (this.settings.epgAutoRefresh?.() === false) break;
                const active = this.settings.epgUrl().includes(url);
                if (!active) continue;
                try {
                    const result = await this.bridge.forceFetchEpg(
                        url, this.settings.getTrustOptions()
                    );
                    if (result?.success) this.sources.notifyGuideUpdated();
                } catch {
                    // Progress UI owns per-source failures and the manual Retry.
                }
            }
        } finally {
            this.running = false;
        }
    }

    private lastRefresh(): number {
        try {
            const value = Number(localStorage.getItem(LAST_REFRESH_KEY));
            return Number.isFinite(value) && value > 0 ? value : 0;
        } catch { return 0; }
    }

    private writeRefresh(time: number): void {
        try { localStorage.setItem(LAST_REFRESH_KEY, String(time)); }
        catch { /* Optional storage only. */ }
    }
}

/** Synthetic live favorites and EPG readiness for the alternate dashboard. */
import type { Page } from '@playwright/test';
import { requirePlaylistId } from './capture-navigation-helpers';
import { openSettings } from './capture-navigation-setup-actions';

export async function setCinematicLiveFavorites(
    page: Page,
    enabled: boolean
): Promise<void> {
    // Re-entering the dashboard after a real route change refreshes its data.
    await openSettings(page);
    await page.evaluate(
        async ({ playlistId, enabled }) => {
            const bridge = window.electron;
            if (!bridge?.dbGetContentByXtreamId)
                throw new Error('Live fixture bridge unavailable');
            // Lead with news, sport, family, documentary and music.
            for (const index of [0, 2, 4, 6, 7, 5, 3, 1]) {
                const content = await bridge.dbGetContentByXtreamId(
                    52000 + index,
                    playlistId,
                    'live'
                );
                if (!content) {
                    if (enabled)
                        throw new Error(
                            `Synthetic live channel missing: ${52000 + index}`
                        );
                    continue;
                }
                if (enabled) await bridge.dbAddFavorite(content.id, playlistId);
                else await bridge.dbRemoveFavorite(content.id, playlistId);
            }
        },
        { playlistId: requirePlaylistId('xtreams'), enabled }
    );
}

export async function waitForCinematicLiveEpg(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const rail = document.querySelector(
                '[data-test-id="dashboard-live-favorites-rail"]'
            );
            const cards = [
                ...(rail?.querySelectorAll<HTMLElement>(
                    '.rail__card--channel'
                ) ?? []),
            ].filter((card) => {
                const rect = card.getBoundingClientRect();
                return rect.right > 100 && rect.left < innerWidth - 50;
            });
            return (
                cards.length >= 4 &&
                cards.every((card) => {
                    const logo = card.querySelector<HTMLImageElement>(
                        '.rail__channel-logo img'
                    );
                    return (
                        logo?.complete &&
                        logo.naturalWidth > 0 &&
                        !!card
                            .querySelector('.rail__channel-now')
                            ?.textContent?.trim() &&
                        !!card
                            .querySelector('.rail__channel-time')
                            ?.textContent?.trim() &&
                        !card.querySelector(
                            '.rail__channel-progress--idle, [data-test-id="rail-now-placeholder"]'
                        )
                    );
                })
            );
        },
        undefined,
        { timeout: 30_000 }
    );
}

export interface CinematicLiveFrameReport {
    continueBottom: number;
    liveTop: number;
    viewportHeight: number;
    cards: Array<{
        name: string;
        programme: string;
        timeRange: string;
        logoLoaded: boolean;
        progressReady: boolean;
        bottom: number;
    }>;
}

/** Fail the capture if channels, current programmes or the second rail are clipped. */
export function cinematicLiveFrameViolations(
    report: CinematicLiveFrameReport
): string[] {
    const failures: string[] = [];
    if (report.continueBottom <= 0 || report.liveTop < report.continueBottom)
        failures.push(
            'Live channels must follow the visible Continue Watching rail'
        );
    if (report.cards.length < 4)
        failures.push('At least four different live channels must be visible');
    if (
        new Set(report.cards.map((card) => card.name)).size !==
        report.cards.length
    )
        failures.push('Live channel identities must be distinct');
    for (const card of report.cards) {
        if (
            !card.name ||
            !card.programme ||
            !/\d{1,2}:\d{2}/.test(card.timeRange) ||
            !card.logoLoaded ||
            !card.progressReady
        )
            failures.push(
                'Every visible channel needs a decoded logo, name, current programme, time and progress'
            );
        if (card.bottom > report.viewportHeight)
            failures.push('Live cards must fit inside the frame');
    }
    return failures;
}

export async function assertCinematicLiveFrame(page: Page): Promise<void> {
    await waitForCinematicLiveEpg(page);
    const report = await page.evaluate(() => {
        const rail = document.querySelector(
            '[data-test-id="dashboard-live-favorites-rail"]'
        );
        return {
            continueBottom:
                document
                    .querySelector(
                        '[data-test-id="dashboard-continue-watching-rail"]'
                    )
                    ?.getBoundingClientRect().bottom ?? 0,
            liveTop: rail?.getBoundingClientRect().top ?? -1,
            viewportHeight: innerHeight,
            cards: [
                ...(rail?.querySelectorAll<HTMLElement>(
                    '.rail__card--channel'
                ) ?? []),
            ]
                .filter((card) => {
                    const rect = card.getBoundingClientRect();
                    return rect.right > 100 && rect.left < innerWidth - 50;
                })
                .map((card) => {
                    const logo = card.querySelector<HTMLImageElement>(
                        '.rail__channel-logo img'
                    );
                    return {
                        name:
                            card
                                .querySelector('.rail__channel-name')
                                ?.textContent?.trim() ?? '',
                        programme:
                            card
                                .querySelector('.rail__channel-now')
                                ?.textContent?.trim() ?? '',
                        timeRange:
                            card
                                .querySelector('.rail__channel-time')
                                ?.textContent?.trim() ?? '',
                        logoLoaded: !!logo?.complete && logo.naturalWidth > 0,
                        progressReady: !card.querySelector(
                            '.rail__channel-progress--idle, [data-test-id="rail-now-placeholder"]'
                        ),
                        bottom: card.getBoundingClientRect().bottom,
                    };
                }),
        };
    });
    const failures = cinematicLiveFrameViolations(report);
    if (failures.length)
        throw new Error(`Cinematic live frame failed: ${failures.join('; ')}`);
}

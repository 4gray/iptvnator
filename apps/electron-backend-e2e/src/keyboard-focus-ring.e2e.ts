import type { Locator, Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickFirstGridListCard,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { applyTheme } from './theme-contrast';

// ---------------------------------------------------------------------------
// Keyboard focus is visible everywhere. The global stylesheet used to strip
// the outline from every input, button and `:focus`; it now draws a fallback
// ring on `:focus-visible`, and a component with an indicator of its own
// keeps it. Every Tab stop below must show exactly one ring, on itself or on
// the ancestor or sibling that draws it for it (a content card, a checkbox,
// a select's form-field outline), in both themes, at 3:1 against what it
// sits on where that is a flat colour. A mouse click leaves no ring.
// ---------------------------------------------------------------------------

type Ring = {
    kind: 'outline' | 'box-shadow' | 'field-outline';
    on: string;
    color: string;
    /** Null where the ring sits on artwork or a gradient. */
    contrast: number | null;
};

type Stop = { element: string; label: string; rings: Ring[] };

type Probe = {
    capture(): { element: string; label: string };
    settle(): Ring[];
    clicked(): { element: string; focusVisible: boolean; outline: string };
};

declare global {
    interface Window {
        __focusRingProbe?: Probe;
    }
}

/** Calls one method of the probe installed in the page. */
function callProbe<M extends keyof Probe>(
    page: Page,
    method: M
): Promise<ReturnType<Probe[M]>> {
    return page.evaluate((name) => {
        const probe = window.__focusRingProbe;
        if (!probe) throw new Error('The focus ring probe is not installed.');
        return probe[name]() as ReturnType<Probe[M]>;
    }, method);
}

/**
 * Installs the in-page probe. `capture` snapshots the rings around the
 * focused element; `settle`, run once focus has moved on, reports the rings
 * that went away with it, i.e. the ones that focus drew.
 */
async function installProbe(page: Page): Promise<void> {
    await page.evaluate(() => {
        if (window.__focusRingProbe) return;
        const canvas = document.createElement('canvas').getContext('2d', {
            willReadFrequently: true,
        }) as CanvasRenderingContext2D;
        const transparent = (color: string) =>
            color === 'transparent' || /,\s*0\)$/.test(color);
        const ringOf = (el: Element) => {
            const style = getComputedStyle(el);
            const outline =
                style.outlineStyle !== 'none' &&
                parseFloat(style.outlineWidth) > 0 &&
                !transparent(style.outlineColor)
                    ? style.outlineColor
                    : '';
            // A focus ring drawn as a spread shadow: `<color> 0 0 0 2px`.
            const shadow = /(rgba?\([^)]*\)) 0px 0px 0px [1-9]/.exec(
                style.boxShadow
            );
            return {
                outline,
                offset: parseFloat(style.outlineOffset) || 0,
                shadow: shadow?.[1] ?? '',
                // A Material form field shows focus on its outline's border.
                border: el.classList.contains('mdc-notched-outline__leading')
                    ? `${style.borderTopWidth} ${style.borderTopColor}`
                    : '',
            };
        };
        const name = (el: Element) =>
            el.tagName.toLowerCase() +
            [...el.classList]
                .filter((c) => !c.startsWith('ng-') && !c.startsWith('cdk-'))
                .slice(0, 2)
                .map((c) => `.${c}`)
                .join('');
        /** Luminance of `colors` painted in order over white. */
        const paint = (colors: string[]) => {
            canvas.fillStyle = '#fff';
            canvas.fillRect(0, 0, 1, 1);
            for (const color of colors) {
                canvas.fillStyle = color;
                canvas.fillRect(0, 0, 1, 1);
            }
            const [r, g, b] = Array.from(
                canvas.getImageData(0, 0, 1, 1).data.slice(0, 3)
            ).map((channel) => {
                const c = channel / 255;
                return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        /** Background layers from the root down to `el`, or null on art. */
        const layersUnder = (el: Element | null) => {
            const layers: string[] = [];
            for (let node = el; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (style.backgroundImage !== 'none') return null;
                layers.unshift(style.backgroundColor);
            }
            return layers;
        };
        const contrastOf = (on: Element, color: string, inside: boolean) => {
            const layers = layersUnder(inside ? on : on.parentElement);
            if (!layers) return null;
            const back = paint(layers);
            const ring = paint([...layers, color]);
            return (
                (Math.max(back, ring) + 0.05) / (Math.min(back, ring) + 0.05)
            );
        };

        let pending: {
            candidates: Element[];
            before: ReturnType<typeof ringOf>[];
        } | null = null;

        window.__focusRingProbe = {
            capture() {
                const el = document.activeElement ?? document.body;
                const candidates = [el];
                for (
                    let node = el.parentElement, depth = 0;
                    node && depth < 3;
                    node = node.parentElement, depth++
                ) {
                    candidates.push(node);
                }
                for (const sibling of el.parentElement?.children ?? []) {
                    if (sibling !== el) candidates.push(sibling);
                }
                const fieldOutline = el
                    .closest('.mat-mdc-form-field')
                    ?.querySelector('.mdc-notched-outline__leading');
                if (fieldOutline) candidates.push(fieldOutline);
                pending = { candidates, before: candidates.map(ringOf) };
                return {
                    element: name(el),
                    label: (
                        el.getAttribute('aria-label') ??
                        el.textContent ??
                        ''
                    )
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 40),
                };
            },
            settle() {
                if (!pending) return [];
                const { candidates, before } = pending;
                pending = null;
                return candidates.flatMap((on, index) => {
                    const was = before[index];
                    const now = ringOf(on);
                    const rings: Ring[] = [];
                    if (was.outline && was.outline !== now.outline) {
                        rings.push({
                            kind: 'outline',
                            on: name(on),
                            color: was.outline,
                            contrast: contrastOf(
                                on,
                                was.outline,
                                was.offset < 0
                            ),
                        });
                    }
                    if (was.shadow && was.shadow !== now.shadow) {
                        rings.push({
                            kind: 'box-shadow',
                            on: name(on),
                            color: was.shadow,
                            contrast: contrastOf(on, was.shadow, false),
                        });
                    }
                    if (was.border && was.border !== now.border) {
                        const color = getComputedStyle(on).borderTopColor;
                        const focused = was.border.replace(/^\S+ /, '');
                        rings.push({
                            kind: 'field-outline',
                            on: name(on),
                            color: focused,
                            // Against the field's own fill, inside the line.
                            contrast:
                                focused === color
                                    ? null
                                    : contrastOf(on, focused, true),
                        });
                    }
                    return rings;
                });
            },
            clicked() {
                const el = document.activeElement ?? document.body;
                return {
                    element: name(el),
                    focusVisible: el.matches(':focus-visible'),
                    outline: ringOf(el).outline,
                };
            },
        };
    });
}

/**
 * Tabs from `from` through `area`, up to `limit` stops, and reports the
 * rings each stop drew. `from` is entered from the keyboard (Tab, then
 * Shift+Tab) so it matches `:focus-visible` like the stops after it.
 */
async function tabThrough(
    page: Page,
    area: Locator,
    from: Locator,
    limit: number
): Promise<Stop[]> {
    await installProbe(page);
    await from.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(from).toBeFocused();

    const stops: Stop[] = [];
    while (stops.length < limit) {
        const inside = await area.evaluate((root) =>
            root.contains(document.activeElement)
        );
        if (!inside) break;
        const focused = await callProbe(page, 'capture');
        await page.keyboard.press('Tab');
        const rings = await callProbe(page, 'settle');
        stops.push({ ...focused, rings });
    }
    return stops;
}

/** Every stop shows one ring with 3:1 against a flat background. */
function expectOneVisibleRing(stops: Stop[], context: string): void {
    expect(stops.length, `${context}: Tab stops`).toBeGreaterThan(1);
    for (const stop of stops) {
        const where = `${context}: ${stop.element} "${stop.label}"`;
        expect(stop.rings, where).toHaveLength(1);
        const [ring] = stop.rings;
        if (ring.contrast !== null) {
            expect(
                ring.contrast,
                `${where} ring contrast`
            ).toBeGreaterThanOrEqual(3);
        }
    }
}

/** A mouse click focuses `target` without a ring. */
async function expectNoRingAfterClick(
    page: Page,
    target: Locator,
    context: string
): Promise<void> {
    await installProbe(page);
    await target.click();
    const clicked = await callProbe(page, 'clicked');
    expect(clicked, `${context}: focus after a click`).toEqual({
        element: clicked.element,
        focusVisible: false,
        outline: '',
    });
}

async function openFirstSeries(page: Page): Promise<void> {
    await openWorkspaceSection(page, 'Series');
    await clickFirstGridListCard(page);
    await expect(page.locator('[data-test-id="episodes-heading"]')).toBeVisible(
        { timeout: 20_000 }
    );
}

async function openMoviesWithRatingFilter(page: Page): Promise<void> {
    await openWorkspaceSection(page, 'Movies');
    const view = page.locator('app-category-content-view');
    await expect(view.locator('mat-card').first()).toBeVisible({
        timeout: 20_000,
    });
    await view.locator('.refine-action').click();
    await page.getByRole('menuitem', { name: /^\s*5\.0 and higher/ }).click();
    await expect(view.locator('.rating-refinement-chip')).toBeVisible();
}

test.describe('Keyboard focus ring', () => {
    test('@electron @theme every Tab stop shows one visible ring in both themes, a click none', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        const report: Record<string, Stop[]> = {};
        try {
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);

            const walk = async (
                context: string,
                area: Locator,
                from: Locator,
                limit: number
            ) => {
                for (const theme of ['light', 'dark'] as const) {
                    await applyTheme(page, theme);
                    const stops = await tabThrough(page, area, from, limit);
                    report[`${context} (${theme})`] = stops;
                    expectOneVisibleRing(stops, `${context} in ${theme}`);
                }
            };

            // Detail page: the hero's action row, then the season tabs.
            await openFirstSeries(page);
            const shell = page.locator('app-portal-detail-shell');
            await walk(
                'detail actions and season tabs',
                shell,
                shell.locator('app-detail-action-button button').first(),
                14
            );
            expect(
                report['detail actions and season tabs (dark)'].map(
                    (stop) => stop.element
                )
            ).toContain('button.season-tabs__pill');

            const pill = shell.locator('.season-tabs__pill').first();
            await expectNoRingAfterClick(page, pill, 'season tab');
            await expectNoRingAfterClick(
                page,
                shell.locator('.mat-button-toggle-button').last(),
                'episode view toggle'
            );

            // A catalog grid and its refinement chips. Closing the refine
            // menu with a click hands focus back to its trigger by script:
            // still pointer focus, so no ring.
            await openMoviesWithRatingFilter(page);
            await installProbe(page);
            expect(await callProbe(page, 'clicked')).toEqual({
                element: expect.stringContaining('mat-mdc-button-base'),
                focusVisible: false,
                outline: '',
            });
            const view = page.locator('app-category-content-view');
            await walk(
                'catalog refinements and grid',
                view,
                view.locator('.rating-refinement-chip'),
                6
            );

            // Sources: the type filters, then the list's row actions.
            await openSources(page);
            await expect(
                page.locator('app-playlist-item').first()
            ).toBeVisible();
            await walk(
                'sources list',
                page.locator('app-workspace-shell'),
                page
                    .locator('app-workspace-sources-filters-panel button')
                    .first(),
                12
            );
            expect(
                report['sources list (dark)'].map((stop) => stop.label)
            ).toContain('Check again');

            // Settings: the section navigation, then the first page's
            // controls (selects, switches, the theme switcher).
            await openSettings(page);
            const firstSection = page
                .locator('[data-test-id^="settings-section-"]')
                .first();
            await walk(
                'settings',
                page.locator('app-workspace-shell'),
                firstSection,
                24
            );
            const toggle = page
                .getByTestId('settings-container')
                .locator('mat-slide-toggle [role="switch"]')
                .first();
            await expectNoRingAfterClick(page, toggle, 'settings switch');
            await toggle.click();
        } finally {
            // Every stop and the rings it drew, for a failure on CI.
            await test.info().attach('focus-stops.json', {
                body: JSON.stringify(report, null, 2),
                contentType: 'application/json',
            });
            await closeElectronApp(app);
        }
    });
});

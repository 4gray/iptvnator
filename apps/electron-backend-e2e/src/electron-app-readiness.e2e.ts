import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
    waitForAppReady,
} from './electron-test-fixtures';

test('startup waits for a hidden workspace and its rail entrance animation', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        // Model app-root mounting before the source inventory is ready. The
        // animation does not exist while the startup wrapper is display:none.
        await page.setContent(`
            <style>
                @keyframes entrance {
                    from { transform: translateY(-6px); }
                    to { transform: translateY(0); }
                }
                .app-rail a {
                    display: block;
                    animation: entrance 200ms both;
                }
            </style>
            <app-root>
                <p>Loading synthetic sources</p>
                <div id="startup" style="display: none">
                    <nav class="app-rail"><a>Synthetic destination</a></nav>
                </div>
            </app-root>
        `);
        await page.locator('.app-rail').evaluate((rail) => {
            const getAnimations = rail.getAnimations.bind(rail);
            rail.getAnimations = (options) => {
                rail.setAttribute(
                    'data-collected-while-hidden',
                    String(rail.getClientRects().length === 0)
                );
                return getAnimations(options);
            };
            // Only the test models delayed source readiness with a timer; the
            // launcher must observe visibility and animation completion.
            setTimeout(() => {
                document.getElementById('startup')!.style.display = 'contents';
            }, 500);
        });

        await waitForAppReady(page);

        await expect(page.locator('.app-rail')).toHaveAttribute(
            'data-collected-while-hidden',
            'false'
        );
        const state = await page.locator('.app-rail a').evaluate((link) => ({
            visible: link.getClientRects().length > 0,
            animations: link
                .getAnimations()
                .map((animation) => animation.playState),
            offset: new DOMMatrix(getComputedStyle(link).transform).m42,
        }));
        expect(state.visible).toBe(true);
        expect(state.animations).toEqual(['finished']);
        expect(state.offset).toBe(0);
    } finally {
        await closeElectronApp(app);
    }
});

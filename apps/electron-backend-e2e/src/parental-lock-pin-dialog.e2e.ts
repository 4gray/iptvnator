import { Locator, Page } from '@playwright/test';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    test,
} from './electron-test-fixtures';

/**
 * The parental-lock PIN dialog (Settings → Parental lock):
 *
 *   1. Setting a PIN, a repeat that differs is shown on the repeat field as
 *      soon as it is as long as the PIN, marked `aria-invalid` and placed
 *      in the field's live region. Enter is refused visibly — the field
 *      shakes, except under reduced motion — instead of being swallowed by
 *      a disabled submit button; fixing the repeat saves.
 *   2. Every flow names its own submit verb: Save PIN, Confirm (current PIN
 *      before a change), Unlock, Turn off; the dismiss button is Cancel.
 */

const PIN = '2468';
const THEMES = [
    { dark: false, color: 'rgb(179, 38, 30)' },
    { dark: true, color: 'rgb(255, 180, 171)' },
] as const;

function pinDialog(page: Page) {
    // The newest one: a flow can open the next prompt as one closes.
    const dialog = page
        .locator('mat-dialog-container', {
            has: page.locator('app-parental-lock-pin-dialog'),
        })
        .last();
    return {
        dialog,
        pin: dialog.getByTestId('parental-lock-pin'),
        confirm: dialog.getByTestId('parental-lock-pin-confirm'),
        submit: dialog.getByTestId('parental-lock-pin-submit'),
        cancel: dialog.getByRole('button', { name: 'Cancel', exact: true }),
        mismatch: dialog.getByTestId('parental-lock-pin-mismatch'),
    };
}

async function openParentalSettings(page: Page): Promise<Locator> {
    await openSettings(page);
    await openSettingsSection(page, 'parental');
    return page.locator(
        '[data-test-id="parental-lock-enabled"] button[role="switch"]'
    );
}

/**
 * Presses Enter in `input` and reports the field's animation at the moment
 * the shake class lands (a MutationObserver sees it synchronously, well
 * inside the 400ms the class stays on).
 */
async function pressEnterAndCatchShake(input: Locator): Promise<string | null> {
    const field = input.locator('xpath=ancestor::mat-form-field');
    await expect(field).not.toHaveClass(/pin-dialog__field--shake/);
    await field.evaluate((element) => {
        const target = element as HTMLElement & { shakeAnimation?: string };
        delete target.shakeAnimation;
        const observer = new MutationObserver(() => {
            if (target.classList.contains('pin-dialog__field--shake')) {
                target.shakeAnimation = getComputedStyle(target).animationName;
                observer.disconnect();
            }
        });
        observer.observe(target, { attributeFilter: ['class'] });
    });
    await input.press('Enter');
    await expect
        .poll(() =>
            field.evaluate(
                (element) =>
                    (element as HTMLElement & { shakeAnimation?: string })
                        .shakeAnimation ?? null
            )
        )
        .not.toBeNull();
    return field.evaluate(
        (element) =>
            (element as HTMLElement & { shakeAnimation?: string })
                .shakeAnimation ?? null
    );
}

test.describe('Electron parental-lock PIN dialog', () => {
    test('@settings @parental @electron shows, announces and refuses a mismatched repeat, then saves the fixed PIN', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            const page = app.mainWindow;
            const toggle = await openParentalSettings(page);
            await expect(toggle).toHaveAttribute('aria-checked', 'false');
            await toggle.click();

            const { dialog, pin, confirm, submit, cancel, mismatch } =
                pinDialog(page);
            await expect(pin).toBeFocused();
            await expect(submit).toHaveText('Save PIN');
            await expect(cancel).toBeVisible();
            await expect(pin).toHaveAttribute('autocomplete', 'new-password');
            await expect(confirm).toHaveAttribute(
                'autocomplete',
                'new-password'
            );

            // Enter after the PIN moves on to the empty repeat; Save
            // with the repeat still empty is refused.
            await pin.fill(PIN);
            await pin.press('Enter');
            await expect(confirm).toBeFocused();
            await expect(mismatch).toBeHidden();
            await submit.click();
            await expect(mismatch).toBeVisible();
            await expect(dialog).toBeVisible();

            await confirm.fill(PIN.slice(0, 3));
            await expect(mismatch).toBeHidden();
            await expect(confirm).toHaveAttribute('aria-invalid', 'false');

            // As long as the PIN and different: shown before any submit.
            await confirm.fill('2469');
            await expect(mismatch).toHaveText('The two PINs do not match.');
            await expect(confirm).toHaveAttribute('aria-invalid', 'true');
            const errorId = await mismatch.getAttribute('id');
            expect(await confirm.getAttribute('aria-describedby')).toContain(
                errorId
            );
            await expect(
                mismatch.locator('xpath=ancestor::*[@aria-live="polite"]')
            ).toHaveCount(1);

            // The parental-lock red in both themes, on the text and outline.
            const outline = confirm
                .locator('xpath=ancestor::mat-form-field')
                .locator('.mdc-notched-outline__leading');
            for (const theme of THEMES) {
                await page.evaluate(
                    (dark) =>
                        document.body.classList.toggle('dark-theme', dark),
                    theme.dark
                );
                await expect(mismatch).toHaveCSS('color', theme.color);
                await expect(outline).toHaveCSS(
                    'border-top-color',
                    theme.color
                );
            }

            // Enter is refused with a shake, or without one under reduced
            // motion; the dialog stays and nothing is saved.
            await page.emulateMedia({ reducedMotion: 'reduce' });
            expect(await pressEnterAndCatchShake(confirm)).toBe('none');
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            expect(await pressEnterAndCatchShake(confirm)).toContain(
                'pin-dialog-shake'
            );
            // Refused again while it still shakes, the field shakes from
            // the start: its class never comes off, so the animation is
            // rewound. Held at 300ms, the second refusal must reset it.
            const replayedAt = await dialog
                .locator('form')
                .evaluate(async (form: HTMLFormElement) => {
                    const nextFrame = () =>
                        new Promise((resolve) =>
                            requestAnimationFrame(() =>
                                requestAnimationFrame(resolve)
                            )
                        );
                    const field = form
                        .querySelector(
                            '[data-test-id="parental-lock-pin-confirm"]'
                        )
                        ?.closest('mat-form-field') as HTMLElement;
                    form.requestSubmit();
                    await nextFrame();
                    const [shake] = field.getAnimations();
                    shake.pause();
                    shake.currentTime = 300;
                    form.requestSubmit();
                    await nextFrame();
                    return shake.currentTime;
                });
            expect(replayedAt).toBe(0);
            await expect(dialog).toBeVisible();
            await expect(mismatch).toBeVisible();
            await expect(toggle).toHaveAttribute('aria-checked', 'false');
            // Refused from the PIN field, focus moves to the repeat.
            await pin.press('Enter');
            await expect(confirm).toBeFocused();

            await confirm.fill(PIN);
            await expect(mismatch).toBeHidden();
            await expect(confirm).toHaveAttribute('aria-invalid', 'false');
            await confirm.press('Enter');
            await expect(dialog).toBeHidden();
            await expect(toggle).toHaveAttribute('aria-checked', 'true');
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@settings @parental @electron names each PIN flow with its own submit verb', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            const page = app.mainWindow;
            const toggle = await openParentalSettings(page);
            const { dialog, pin, confirm, submit, cancel } = pinDialog(page);

            await toggle.click();
            await expect(submit).toHaveText('Save PIN');
            await pin.fill(PIN);
            await confirm.fill(PIN);
            await submit.click();
            await expect(toggle).toHaveAttribute('aria-checked', 'true');

            // Change PIN: the current PIN is confirmed, the new one saved.
            await page.getByTestId('parental-lock-change-pin').click();
            await expect(submit).toHaveText('Confirm');
            await expect(confirm).toHaveCount(0);
            await pin.fill(PIN);
            await pin.press('Enter');
            await expect(confirm).toBeVisible();
            await expect(submit).toHaveText('Save PIN');
            await cancel.click();
            await expect(dialog).toBeHidden();

            await page.getByTestId('parental-lock-lock-now').click();
            await page.getByTestId('parental-lock-unlock').click();
            await expect(submit).toHaveText('Unlock');
            await expect(cancel).toBeVisible();
            // A wrong PIN keeps the field focused for the next try, although
            // it is disabled while the PIN is checked.
            await pin.fill('1357');
            await pin.press('Enter');
            await expect(
                dialog.getByTestId('parental-lock-pin-error')
            ).toHaveText('Wrong PIN. Try again.');
            await expect(pin).toHaveAttribute('aria-invalid', 'true');
            await expect(pin).toBeFocused();
            await pin.fill(PIN);
            await pin.press('Enter');
            await expect(dialog).toBeHidden();
            await expect(
                page.getByTestId('parental-lock-lock-now')
            ).toBeVisible();

            await toggle.click();
            await expect(submit).toHaveText('Turn off');
            await pin.fill(PIN);
            await pin.press('Enter');
            await expect(dialog).toBeHidden();
            await expect(toggle).toHaveAttribute('aria-checked', 'false');
        } finally {
            await closeElectronApp(app);
        }
    });
});

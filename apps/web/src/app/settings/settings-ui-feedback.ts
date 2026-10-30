/** Lets settings paint the busy state before backup/reset work starts. */
export async function waitForSettingsUiFeedbackFrame(): Promise<void> {
    if (typeof window.requestAnimationFrame !== 'function') {
        await Promise.resolve();
        return;
    }

    await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
    });
}

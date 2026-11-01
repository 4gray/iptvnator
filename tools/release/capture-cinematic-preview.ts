import type { ElectronApplication } from '@playwright/test';
import { createInterface } from 'node:readline';

/** Return true when the user closes Electron before the final request audit. */
export async function waitForCinematicPreview(
    app: ElectronApplication
): Promise<boolean> {
    console.log(
        'Cinematic demo ready. Explore the dashboard, favorites and series.'
    );
    console.log(
        'Press Enter in this terminal or close the demo window to finish.'
    );
    const input = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    let windowClosed = false;
    let finish = () => undefined;
    const closed = () => {
        windowClosed = true;
        finish();
    };
    const interrupted = () => finish();
    try {
        await new Promise<void>((resolve) => {
            finish = resolve;
            input.once('line', interrupted);
            input.once('SIGINT', interrupted);
            process.once('SIGINT', interrupted);
            app.once('close', closed);
        });
    } finally {
        process.removeListener('SIGINT', interrupted);
        app.removeListener('close', closed);
        input.close();
    }
    return windowClosed;
}

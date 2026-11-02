import type { ElectronApplication, Page } from '@playwright/test';
import { createInterface } from 'node:readline';

/** Return true when the preview window or Electron closes before the audit. */
export async function waitForCinematicPreview(
    app: ElectronApplication,
    page: Page,
    io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = {
        input: process.stdin,
        output: process.stdout,
    }
): Promise<boolean> {
    io.output.write(
        'Cinematic demo ready. Explore the dashboard, favorites and series.\n'
    );
    io.output.write(
        'Press Enter in this terminal or close the demo window to finish.\n'
    );
    const input = createInterface(io);
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
            // On macOS the last window can close while Electron stays alive.
            page.once('close', closed);
            if (page.isClosed()) closed();
        });
    } finally {
        process.removeListener('SIGINT', interrupted);
        app.removeListener('close', closed);
        page.removeListener('close', closed);
        input.close();
    }
    return windowClosed;
}

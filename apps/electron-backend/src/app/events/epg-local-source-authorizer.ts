import { BrowserWindow, dialog } from 'electron';

/**
 * Main-process gate for local XMLTV files.
 *
 * The renderer hands EPG source strings to `FETCH_EPG`/`EPG_FORCE_FETCH`
 * unchanged, so a compromised renderer could name any file on disk. Like
 * `save-file-dialog` → `write-file` for playlist exports, the decision
 * therefore lives here: a path is readable only after the native picker
 * returned it or the user allowed it in a native confirmation the renderer
 * cannot fake. Allowed paths persist in the main-process config so startup
 * refreshes need no prompt.
 */
export interface EpgLocalSourceAuthorizer {
    /** A file the user chose in the native picker is trusted right away. */
    authorize(filePath: string): void;
    /** Whether `filePath` may be read; prompts once for a hand-typed path. */
    ensureAllowed(filePath: string): Promise<boolean>;
}

export interface EpgLocalSourcePersistence {
    load(): string[];
    save(filePaths: string[]): void;
}

export const EPG_LOCAL_SOURCE_REFUSED_MESSAGE =
    'Reading this local file was not allowed. Retry to be asked again.';

/** Refuses every local file; the real authorizer is wired at registration. */
export const DENY_ALL_EPG_LOCAL_SOURCES: EpgLocalSourceAuthorizer = {
    authorize: () => undefined,
    ensureAllowed: () => Promise.resolve(false),
};

export class PersistedEpgLocalSourceAuthorizer implements EpgLocalSourceAuthorizer {
    private readonly pendingPrompts = new Map<string, Promise<boolean>>();

    constructor(
        private readonly persistence: EpgLocalSourcePersistence,
        private readonly prompt: (filePath: string) => Promise<boolean>
    ) {}

    authorize(filePath: string): void {
        const allowed = this.persistence.load();
        if (allowed.includes(filePath)) {
            return;
        }
        this.persistence.save([...allowed, filePath]);
    }

    ensureAllowed(filePath: string): Promise<boolean> {
        if (this.persistence.load().includes(filePath)) {
            return Promise.resolve(true);
        }
        // Concurrent fetches of the same file (settings save plus a startup
        // refresh) share one prompt instead of stacking dialogs.
        const pending = this.pendingPrompts.get(filePath);
        if (pending) {
            return pending;
        }
        const decision = this.prompt(filePath)
            .then((allowed) => {
                if (allowed) {
                    this.authorize(filePath);
                }
                return allowed;
            })
            .finally(() => {
                this.pendingPrompts.delete(filePath);
            });
        this.pendingPrompts.set(filePath, decision);
        return decision;
    }
}

/** Native confirmation for a hand-typed local EPG path. */
export async function promptForLocalEpgSource(
    filePath: string
): Promise<boolean> {
    const options: Electron.MessageBoxOptions = {
        type: 'question',
        title: 'Allow local EPG file?',
        message: 'Read this file as an EPG source?',
        detail: `${filePath}\n\nIPTVnator will read the XMLTV guide data in this file. Only allow files you added yourself.`,
        buttons: ['Allow', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
    };
    const window =
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const { response } = window
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options);
    return response === 0;
}

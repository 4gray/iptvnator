jest.mock('electron', () => ({
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    dialog: { showMessageBox: jest.fn() },
}));

import { dialog } from 'electron';
import {
    PersistedEpgLocalSourceAuthorizer,
    promptForLocalEpgSource,
} from './epg-local-source-authorizer';

describe('PersistedEpgLocalSourceAuthorizer', () => {
    let stored: string[];
    let prompt: jest.Mock;
    let authorizer: PersistedEpgLocalSourceAuthorizer;

    beforeEach(() => {
        stored = [];
        prompt = jest.fn();
        authorizer = new PersistedEpgLocalSourceAuthorizer(
            {
                load: () => [...stored],
                save: (paths) => {
                    stored = [...paths];
                },
            },
            prompt
        );
    });

    it('trusts a picked file without prompting and persists it once', async () => {
        authorizer.authorize('/epg/guide.xml');
        authorizer.authorize('/epg/guide.xml');

        await expect(authorizer.ensureAllowed('/epg/guide.xml')).resolves.toBe(
            true
        );
        expect(prompt).not.toHaveBeenCalled();
        expect(stored).toEqual(['/epg/guide.xml']);
    });

    it('persists a hand-typed path only after the user allowed it', async () => {
        prompt.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        await expect(authorizer.ensureAllowed('/epg/typed.xml')).resolves.toBe(
            false
        );
        expect(stored).toEqual([]);

        await expect(authorizer.ensureAllowed('/epg/typed.xml')).resolves.toBe(
            true
        );
        expect(stored).toEqual(['/epg/typed.xml']);
        expect(prompt).toHaveBeenCalledTimes(2);

        await expect(authorizer.ensureAllowed('/epg/typed.xml')).resolves.toBe(
            true
        );
        expect(prompt).toHaveBeenCalledTimes(2);
    });

    it('shares one prompt between concurrent requests for the same file', async () => {
        let resolvePrompt: (allowed: boolean) => void = () => undefined;
        prompt.mockReturnValue(
            new Promise<boolean>((resolve) => {
                resolvePrompt = resolve;
            })
        );

        const first = authorizer.ensureAllowed('/epg/shared.xml');
        const second = authorizer.ensureAllowed('/epg/shared.xml');
        expect(prompt).toHaveBeenCalledTimes(1);

        resolvePrompt(true);
        await expect(Promise.all([first, second])).resolves.toEqual([
            true,
            true,
        ]);
        expect(stored).toEqual(['/epg/shared.xml']);
    });
});

describe('promptForLocalEpgSource', () => {
    it('maps the Allow button to true and anything else to false', async () => {
        (dialog.showMessageBox as jest.Mock).mockResolvedValueOnce({
            response: 0,
        });
        await expect(promptForLocalEpgSource('/epg/guide.xml')).resolves.toBe(
            true
        );
        expect(dialog.showMessageBox).toHaveBeenCalledWith(
            expect.objectContaining({
                buttons: ['Allow', 'Cancel'],
                cancelId: 1,
                detail: expect.stringContaining('/epg/guide.xml'),
            })
        );

        (dialog.showMessageBox as jest.Mock).mockResolvedValueOnce({
            response: 1,
        });
        await expect(promptForLocalEpgSource('/epg/guide.xml')).resolves.toBe(
            false
        );
    });
});

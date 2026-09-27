import { persistParentalLockEnabled } from './parental-lock-settings-writer';

describe('persistParentalLockEnabled', () => {
    it('rolls a failed write back to the value recovered by the settings retry', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        let failure: 'load' | 'save' | null = 'load';
        let stored: boolean | undefined = undefined;
        const settings = {
            storageFailure: () => failure,
            parentalLockEnabled: () => stored,
            // The retried read recovers: the switch was already off.
            loadSettings: jest.fn(async () => {
                failure = null;
                stored = false;
            }),
            updateSettings: jest
                .fn()
                .mockRejectedValueOnce(new Error('disk full'))
                .mockResolvedValue(undefined),
        };

        await expect(persistParentalLockEnabled(settings, false)).resolves.toBe(
            false
        );

        // Undone to the recovered `false`, not the hard-coded inverse.
        expect(settings.updateSettings).toHaveBeenLastCalledWith({
            parentalLockEnabled: false,
        });
    });

    it('undoes to the inverse when the switch was never persisted', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const settings = {
            storageFailure: () => null,
            loadSettings: jest.fn(),
            updateSettings: jest
                .fn()
                .mockRejectedValueOnce(new Error('disk full'))
                .mockResolvedValue(undefined),
        };

        await expect(persistParentalLockEnabled(settings, true)).resolves.toBe(
            false
        );

        expect(settings.updateSettings).toHaveBeenLastCalledWith({
            parentalLockEnabled: false,
        });
    });
});

import { deriveStalkerDeviceIdFromMac } from './stalker-identity.utils';

describe('deriveStalkerDeviceIdFromMac', () => {
    // Uppercase hex SHA-256 of the canonical MAC string — the value StbEmu and
    // stalker-to-m3u pin server-side, so it is asserted literally rather than
    // recomputed with the implementation's own algorithm.
    const EXPECTED =
        'A446559A63A6A489959198534E649760C6A9A6474DEE7C20314C2F1903B36422';

    it('derives the reference SHA-256 device id', async () => {
        await expect(
            deriveStalkerDeviceIdFromMac('00:1A:79:AB:CD:EF')
        ).resolves.toBe(EXPECTED);
    });

    it('hashes the canonical form, so input formatting cannot change the id', async () => {
        // A user who types the MAC with hyphens must not end up bound to a
        // different device id than one who types colons — the portal pins the
        // first value it sees, permanently.
        await expect(
            deriveStalkerDeviceIdFromMac('00-1a-79-ab-cd-ef')
        ).resolves.toBe(EXPECTED);
        await expect(
            deriveStalkerDeviceIdFromMac('001A79ABCDEF')
        ).resolves.toBe(EXPECTED);
    });

    it('is 64 uppercase hex characters', async () => {
        await expect(
            deriveStalkerDeviceIdFromMac('00:1A:79:00:00:01')
        ).resolves.toMatch(/^[0-9A-F]{64}$/);
    });

    it('refuses to hash something that is not a MAC', async () => {
        // Hashing a typo would pin the account to it forever.
        await expect(deriveStalkerDeviceIdFromMac('00:1A:79')).resolves.toBeNull();
        await expect(deriveStalkerDeviceIdFromMac('')).resolves.toBeNull();
        await expect(deriveStalkerDeviceIdFromMac(undefined)).resolves.toBeNull();
    });
});

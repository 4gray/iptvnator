import { deriveStalkerDeviceIdsFromMac } from './stalker-identity.utils';

describe('deriveStalkerDeviceIdsFromMac', () => {
    // Uppercase hex SHA-256 of the canonical MAC, and of that MAC plus the
    // `stalker` salt — the values StbEmu and stalker-to-m3u pin server-side.
    // Asserted literally: matching those clients byte for byte is the entire
    // point of the option, so recomputing them with the implementation's own
    // algorithm would assert nothing.
    const EXPECTED = {
        deviceId1:
            'A446559A63A6A489959198534E649760C6A9A6474DEE7C20314C2F1903B36422',
        deviceId2:
            'BBD059367A90B0166654E6D4F9E09786CE64EB97674D1AF8D1EE2AE335D7205B',
    };

    it('derives the reference SHA-256 pair', async () => {
        await expect(
            deriveStalkerDeviceIdsFromMac('00:1A:79:AB:CD:EF')
        ).resolves.toEqual(EXPECTED);
    });

    it('never produces an identical pair', async () => {
        // A real box reports device_id and device_id2 from two separate
        // firmware calls and they are never equal, so an identical pair is a
        // fingerprint no STB produces — and the portal pins the first value it
        // sees permanently, so it cannot be corrected afterwards.
        const derived = await deriveStalkerDeviceIdsFromMac(
            '00:1A:79:00:00:01'
        );

        expect(derived?.deviceId1).not.toBe(derived?.deviceId2);
    });

    it('hashes the canonical form, so input formatting cannot change the ids', async () => {
        // A user who types the MAC with hyphens must not end up bound to
        // different device ids than one who types colons — the portal pins the
        // first values it sees, permanently.
        await expect(
            deriveStalkerDeviceIdsFromMac('00-1a-79-ab-cd-ef')
        ).resolves.toEqual(EXPECTED);
        await expect(
            deriveStalkerDeviceIdsFromMac('001A79ABCDEF')
        ).resolves.toEqual(EXPECTED);
    });

    it('produces 64 uppercase hex characters for both', async () => {
        const derived = await deriveStalkerDeviceIdsFromMac('00:1A:79:00:00:01');

        expect(derived?.deviceId1).toMatch(/^[0-9A-F]{64}$/);
        expect(derived?.deviceId2).toMatch(/^[0-9A-F]{64}$/);
    });

    it('refuses to hash something that is not a MAC', async () => {
        // Hashing a typo would pin the account to it forever.
        await expect(
            deriveStalkerDeviceIdsFromMac('00:1A:79')
        ).resolves.toBeNull();
        await expect(deriveStalkerDeviceIdsFromMac('')).resolves.toBeNull();
        await expect(
            deriveStalkerDeviceIdsFromMac(undefined)
        ).resolves.toBeNull();
    });

    it('derives for a MAC outside the Infomir range', async () => {
        // The OUI is a portal-side policy, not a precondition for hashing.
        await expect(
            deriveStalkerDeviceIdsFromMac('AA:BB:CC:DD:EE:01')
        ).resolves.toEqual({
            deviceId1: expect.stringMatching(/^[0-9A-F]{64}$/),
            deviceId2: expect.stringMatching(/^[0-9A-F]{64}$/),
        });
    });
});

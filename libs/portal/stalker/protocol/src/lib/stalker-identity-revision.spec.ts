import {
    serializeStalkerIdentityRevision,
    serializeStalkerPrincipalInput,
} from './stalker-identity-revision';

describe('Stalker identity revision serialization', () => {
    it('uses a length-prefixed UTF-8 principal without normalization', () => {
        expect([...serializeStalkerPrincipalInput(' é ')]).toEqual([
            0, 0, 0, 4, 0x20, 0xc3, 0xa9, 0x20,
        ]);
        expect(serializeStalkerPrincipalInput('User')).not.toEqual(
            serializeStalkerPrincipalInput('user')
        );
    });

    it('serializes identity fields in a stable canonical order', () => {
        const first = serializeStalkerIdentityRevision({
            deviceId1: 'device|one',
            locale: 'de-DE',
            presetId: 'mag250-public-5_1-minimal-v1',
            presetVersion: 1,
            timezone: 'Europe/Berlin',
            userAgent: 'UA/1',
        });
        const second = serializeStalkerIdentityRevision({
            userAgent: 'UA/1',
            timezone: 'Europe/Berlin',
            presetVersion: 1,
            presetId: 'mag250-public-5_1-minimal-v1',
            locale: 'de-DE',
            deviceId1: 'device|one',
        });

        expect(first).toBe(second);
        expect(first).toContain('stalker-identity-revision:v1');
    });

    it('distinguishes absent, empty, and delimiter-containing values', () => {
        const base = {
            presetId: 'mag250-public-5_1-minimal-v1',
            presetVersion: 1,
        };

        expect(serializeStalkerIdentityRevision(base)).not.toBe(
            serializeStalkerIdentityRevision({ ...base, serialNumber: '' })
        );
        expect(
            serializeStalkerIdentityRevision({
                ...base,
                serialNumber: 'a|b',
            })
        ).not.toBe(
            serializeStalkerIdentityRevision({
                ...base,
                serialNumber: 'a',
                signature1: 'b',
            })
        );
    });
});

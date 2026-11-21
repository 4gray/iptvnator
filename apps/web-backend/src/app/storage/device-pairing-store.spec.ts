import { DevicePairingStore } from './device-pairing-store';
import { withTempStorage } from './server-storage.spec-helpers';

it('reserves room for an owner invitation through approval and completion', () =>
    withTempStorage(({ database }) => {
        const store = new DevicePairingStore(database.sqlite);
        for (let index = 0; index < 99; index++) {
            expect(store.start('Test TV')).not.toBeNull();
        }
        expect(store.start('Another TV')).toBeNull();

        const origin = 'https://host.example.test';
        const invite = store.invite(origin);
        if (!invite) throw new Error('Expected an owner invitation');
        expect(store.invite(origin)).toBeNull();
        const claim = store.claim(invite.inviteId, 'Test browser', origin);
        if (!claim) throw new Error('Expected the invited browser claim');
        expect(store.list().pending).toHaveLength(100);
        expect(store.invite(origin)).toBeNull();
        expect(store.complete(claim.claimId, claim.claimSecret)).toEqual({
            status: 'pending',
        });
        expect(store.approve(claim.claimId)).toBe(true);
        expect(store.complete(claim.claimId, claim.claimSecret)).toMatchObject({
            status: 'approved',
        });

        expect(store.start('Another TV')).toBeNull();
        expect(store.invite(origin)).not.toBeNull();
    }));

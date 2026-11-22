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

it('closes the used Cloudflare invitation when a registered browser reconnects', () =>
    withTempStorage(({ database }) => {
        const store = new DevicePairingStore(database.sqlite);
        const origin = 'https://host.example.test';
        const key = 'synthetic-browser-key';
        const invite = () => {
            const created = store.invite(origin, true);
            if (!created) throw new Error('Expected a Cloudflare invitation');
            return created.inviteId;
        };
        const register = (inviteId: string) =>
            store.registerCloudflareDevice(inviteId, origin, 'Test browser', key);

        expect(register(invite())).toBe('active');
        const [browser] = store.list(true).devices;
        expect(store.setApproval(browser.id, true, true)).toBe(true);
        const reconnect = invite();
        const unused = invite();

        expect(register('')).toBe('active');
        expect(store.list(true, reconnect).inviteActive).toBe(true);
        expect(register(reconnect)).toBe('active');
        expect(store.list(true, reconnect)).toMatchObject({
            inviteActive: false,
            devices: [{ ...browser, canApprove: true }],
        });
        expect(store.list(true, unused).inviteActive).toBe(true);
    }));

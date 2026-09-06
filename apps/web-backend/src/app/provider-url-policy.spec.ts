import { validateProviderUrl } from './provider-url-policy';

const publicV4 = '93.184.216.34';
const publicV6 = '2606:4700:4700::1111';
const policy = {
    allowPrivateNetworkTargets: false,
    resolveHostname: async () => [publicV4],
};
const blocked = [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    'febf::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a00:1',
    '0:0:0:0:0:ffff:a9fe:a9fe',
    '64:ff9b::a00:1',
    '2001:db8::1',
    '2001::1',
    '2002:7f00:1::',
    '3fff::1',
];

describe('provider URL policy', () => {
    it.each(blocked)('rejects literal and DNS answer %s', async (address) => {
        const url = `http://${address.includes(':') ? `[${address}]` : address}/`;
        await expect(validateProviderUrl(url, policy)).resolves.toMatchObject({
            status: 400,
        });
        await expect(
            validateProviderUrl('https://provider.example', {
                ...policy,
                resolveHostname: async () => [publicV4, address],
            })
        ).resolves.toMatchObject({ status: 400 });
    });
    it.each([
        'ftp://host/',
        'file:///etc/passwd',
        'data:text/plain,hello',
        'http://user:secret@host',
        'invalid',
        'http://localhost.',
        'http://sub.localhost',
    ])('rejects %s', async (url) => {
        await expect(validateProviderUrl(url, policy)).resolves.toMatchObject({
            status: 400,
        });
    });
    it.each([
        [],
        ['bad-address'],
        [publicV4, 'host.example'],
        ['127.0.0.1%zone'],
    ])(
        'rejects malformed DNS records %j even with LAN opt-in',
        async (...addresses) => {
            // Jest spreads array table rows; collect the records back into a list.
            for (const allowPrivateNetworkTargets of [false, true]) {
                await expect(
                    validateProviderUrl('https://provider.example', {
                        allowPrivateNetworkTargets,
                        resolveHostname: async () => addresses as string[],
                    })
                ).resolves.toMatchObject({ status: 400 });
            }
        }
    );
    it.each([publicV4, publicV6, '::ffff:5db8:d822'])(
        'accepts public address %s and retains the hostname',
        async (address) => {
            const result = await validateProviderUrl(
                'https://provider.example/path',
                {
                    ...policy,
                    resolveHostname: async () => [address],
                }
            );
            expect(result).toEqual({
                url: new URL('https://provider.example/path'),
                addresses: [address],
            });
        }
    );
    it('resolves and pins trusted LAN hosts while still rejecting schemes and credentials', async () => {
        const trusted = {
            allowPrivateNetworkTargets: true,
            resolveHostname: async () => ['127.0.0.1', '::1'],
        };
        await expect(
            validateProviderUrl('https://lan.example', trusted)
        ).resolves.toMatchObject({ addresses: ['127.0.0.1', '::1'] });
        await expect(
            validateProviderUrl('https://user:secret@lan.example', trusted)
        ).resolves.toMatchObject({ status: 400 });
        await expect(
            validateProviderUrl('file:///tmp/test', trusted)
        ).resolves.toMatchObject({ status: 400 });
    });
});

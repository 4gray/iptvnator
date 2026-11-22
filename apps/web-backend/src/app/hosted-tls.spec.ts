import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHostedTls } from './hosted-tls';

// Synthetic fixture: cert.example.test signed by the test issuer below.
const leaf = `-----BEGIN CERTIFICATE-----
MIIBMTCB2aADAgECAgEBMAoGCCqGSM49BAMCMCoxKDAmBgNVBAMTH0lQVFZuYXRv
ciBzeW50aGV0aWMgdGVzdCBpc3N1ZXIwHhcNMjAwMTAyMDAwMDAwWhcNMzkxMjMx
MDAwMDAwWjAcMRowGAYDVQQDExFjZXJ0LmV4YW1wbGUudGVzdDBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABLW7DOcJ4ticzHKLXmR9j6dWj6iuO7HUTkvcjbVblUWx
TYb7p5760AVCW6vpGKZGnnzJYzOmZD1XlfJvMpa5zTwwCgYIKoZIzj0EAwIDRwAw
RAIgdWyOLXAPQiSAfh47fdEmKoqYBrVCzElMDdH6WwID+vYCIAP+OHedCeJixwZm
NdZNiS2RmiQqU55N6DZPqcDJ+KkV
-----END CERTIFICATE-----
`;
const issuer = `-----BEGIN CERTIFICATE-----
MIIBbzCCARagAwIBAgIIeomPhHw3OccwCgYIKoZIzj0EAwIwKjEoMCYGA1UEAxMf
SVBUVm5hdG9yIHN5bnRoZXRpYyB0ZXN0IGlzc3VlcjAeFw0yMDAxMDEwMDAwMDBa
Fw00MDAxMDEwMDAwMDBaMCoxKDAmBgNVBAMTH0lQVFZuYXRvciBzeW50aGV0aWMg
dGVzdCBpc3N1ZXIwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR1sV4acT31uYkf
sIHZ5Wa0vK2r+XKXQlov6sqY58BHyfbCpKzuOxdxP97UuJOMTl4I5UE7rtH1IkPh
+LGVLNHloyYwJDASBgNVHRMBAf8ECDAGAQH/AgEAMA4GA1UdDwEB/wQEAwICBDAK
BggqhkjOPQQDAgNHADBEAiA+2GxhI6vcmS33fLpjjcC02T0nhbqSuNR5YgY4Mlry
ZwIgdt8tc3e2CxMOFsfB0pi+vuLS24ju/LmCs56FPUek8js=
-----END CERTIFICATE-----
`;
const privateKey = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgblkOWE8rVnkhL0JM
QY5iHJy8tnPbZsyq7XrGMF8YOtOhRANCAAS1uwznCeLYnMxyi15kfY+nVo+orjux
1E5L3I21W5VFsU2G+6ee+tAFQlur6RimRp58yWMzpmQ9V5XybzKWuc08
-----END PRIVATE KEY-----
`;

describe('Custom HTTPS certificate files', () => {
    let directory: string;
    let certificatePath: string;
    let chainPath: string;
    let keyPath: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'iptvnator-tls-'));
        certificatePath = join(directory, 'cert.example.test-crt.pem');
        chainPath = join(directory, 'cert.example.test-chain.pem');
        keyPath = join(directory, 'cert.example.test-key.pem');
        writeFileSync(certificatePath, leaf);
        writeFileSync(keyPath, privateKey);
    });

    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    it('loads a matching adjacent win-acme issuer chain with the selected key', () => {
        writeFileSync(chainPath, leaf + issuer);
        const tls = readHostedTls({ mode: 'https', certificatePath, keyPath });
        expect(tls.cert.toString()).toBe(leaf + issuer);
        expect(tls.key.toString()).toBe(privateKey);
    });

    it.each([
        ['the companion is absent', undefined],
        ['the companion has a different first certificate', issuer + leaf],
        ['the companion repeats the leaf instead of supplying an issuer', leaf + leaf],
        ['the companion contains only the leaf', leaf],
        ['the companion is malformed', leaf + '-----BEGIN CERTIFICATE-----broken-----END CERTIFICATE-----'],
    ])('keeps the selected certificate when %s', (_description, companion) => {
        if (companion !== undefined) writeFileSync(chainPath, companion);
        expect(
            readHostedTls({ mode: 'https', certificatePath, keyPath }).cert.toString()
        ).toBe(leaf);
    });

    it('does not replace explicitly supplied chains or change Cloudflare TLS', () => {
        writeFileSync(chainPath, leaf + issuer);
        expect(
            readHostedTls({ mode: 'https', certificatePath: chainPath, keyPath }).cert.toString()
        ).toBe(leaf + issuer);
        expect(
            readHostedTls({ mode: 'cloudflare', certificatePath, keyPath }).cert.toString()
        ).toBe(leaf);
    });

    it('still rejects a private key that does not match the leaf', () => {
        writeFileSync(chainPath, leaf + issuer);
        const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
        writeFileSync(keyPath, key.export({ type: 'pkcs8', format: 'pem' }));
        expect(() => readHostedTls({ mode: 'https', certificatePath, keyPath }))
            .toThrow(expect.objectContaining({ code: 'HOSTED_TLS' }));
    });
});

import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';

const PEM_CERTIFICATE =
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

function completeWinAcmeChain(path: string, cert: Buffer): Buffer {
    const sibling = path.replace(/-crt\.pem$/i, '-chain.pem');
    if (sibling === path) return cert;

    try {
        const leaf = cert.toString().match(PEM_CERTIFICATE);
        if (leaf?.length !== 1) return cert;

        const chain = readFileSync(sibling);
        const entries = chain.toString().match(PEM_CERTIFICATE);
        if (!entries || entries.length < 2) return cert;

        const certificates = entries.map((entry) => new X509Certificate(entry));
        if (!certificates[0].raw.equals(new X509Certificate(leaf[0]).raw))
            return cert;

        const ordered = certificates.slice(1).every((issuer, index) => {
            const child = certificates[index];
            return (
                issuer.ca &&
                !child.raw.equals(issuer.raw) &&
                child.checkIssued(issuer) &&
                child.verify(issuer.publicKey)
            );
        });
        return ordered ? chain : cert;
    } catch {
        // An absent, unreadable or unrelated companion is not part of this identity.
        return cert;
    }
}

export function readHostedTls({
    mode,
    certificatePath,
    keyPath,
}: {
    mode: 'https' | 'cloudflare';
    certificatePath: string;
    keyPath: string;
}) {
    try {
        const cert = readFileSync(certificatePath);
        const tls = {
            cert:
                mode === 'https'
                    ? completeWinAcmeChain(certificatePath, cert)
                    : cert,
            key: readFileSync(keyPath),
        };
        createSecureContext(tls);
        return tls;
    } catch {
        throw Object.assign(
            new Error('Invalid TLS certificate or private key'),
            { code: 'HOSTED_TLS' }
        );
    }
}

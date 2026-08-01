import crypto from 'node:crypto';
import fs from 'node:fs';

function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

function checksumFailure(expectedSha256, actualSha256) {
    return `SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`;
}

export function downloadPinnedSource({
    archivePath,
    download,
    expectedSha256,
    urls,
}) {
    const partialPath = `${archivePath}.partial`;
    const failures = [];
    const sourceUrls = [...urls];

    if (fs.existsSync(archivePath)) {
        const actualSha256 = sha256File(archivePath);
        if (actualSha256 === expectedSha256) {
            return {
                sourceSha256: actualSha256,
                sourceUrl: null,
                sourceUrls,
            };
        }
        failures.push(
            `cached archive: ${checksumFailure(
                expectedSha256,
                actualSha256
            )}`
        );
        fs.rmSync(archivePath, { force: true });
    }

    for (const url of sourceUrls) {
        fs.rmSync(partialPath, { force: true });
        try {
            download({ destinationPath: partialPath, url });
            const actualSha256 = sha256File(partialPath);
            if (actualSha256 !== expectedSha256) {
                throw new Error(
                    checksumFailure(expectedSha256, actualSha256)
                );
            }
            fs.renameSync(partialPath, archivePath);
            return { sourceSha256: actualSha256, sourceUrl: url, sourceUrls };
        } catch (error) {
            failures.push(`${url}: ${error.message}`);
            fs.rmSync(partialPath, { force: true });
        }
    }

    throw new Error(
        `Unable to download a verified source archive:\n${failures.join('\n')}`
    );
}

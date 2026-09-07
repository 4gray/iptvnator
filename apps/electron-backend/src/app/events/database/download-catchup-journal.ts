import { eq, inArray } from 'drizzle-orm';
import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import * as schema from '../../database/schema';
import type { ArchiveFileIdentity } from './download-catchup-output';
import type { DownloadsDatabase } from './download-task';

export interface ArchiveFinalizationProof {
    version: 1;
    filePath: string;
    size: number;
    partialIdentity: ArchiveFileIdentity;
    finalIdentity: ArchiveFileIdentity;
}

export async function recordArchiveFinalization(
    db: DownloadsDatabase,
    downloadId: number,
    proof: ArchiveFinalizationProof
): Promise<void> {
    const serialized = JSON.stringify({
        ...proof,
        partialIdentity: {
            dev: proof.partialIdentity.dev,
            ino: proof.partialIdentity.ino,
        },
        finalIdentity: {
            dev: proof.finalIdentity.dev,
            ino: proof.finalIdentity.ino,
        },
    });
    await db
        .insert(schema.downloadArchiveFinalizations)
        .values({ downloadId, proof: serialized })
        .onConflictDoUpdate({
            target: schema.downloadArchiveFinalizations.downloadId,
            set: { proof: serialized },
        });
}

/** An explicitly restarted transfer must never inherit an earlier attempt's proof. */
export async function clearArchiveFinalization(
    db: DownloadsDatabase,
    downloadId: number
): Promise<void> {
    await db
        .delete(schema.downloadArchiveFinalizations)
        .where(eq(schema.downloadArchiveFinalizations.downloadId, downloadId));
}

function identity(value: unknown): value is ArchiveFileIdentity {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as ArchiveFileIdentity;
    return (
        Number.isSafeInteger(candidate.dev) &&
        Number.isSafeInteger(candidate.ino)
    );
}

export function parseArchiveFinalization(
    value: string
): ArchiveFinalizationProof | undefined {
    try {
        const proof = JSON.parse(value) as ArchiveFinalizationProof;
        return proof?.version === 1 &&
            typeof proof.filePath === 'string' &&
            isAbsolute(proof.filePath) &&
            Number.isSafeInteger(proof.size) &&
            proof.size > 0 &&
            identity(proof.partialIdentity) &&
            identity(proof.finalIdentity)
            ? proof
            : undefined;
    } catch {
        return undefined;
    }
}

export async function readArchiveFinalizations(
    db: DownloadsDatabase,
    ids: number[]
): Promise<Map<number, ArchiveFinalizationProof>> {
    if (ids.length === 0) return new Map();
    const result = new Map<number, ArchiveFinalizationProof>();
    for (let offset = 0; offset < ids.length; offset += 500) {
        const rows = await db
            .select()
            .from(schema.downloadArchiveFinalizations)
            .where(
                inArray(
                    schema.downloadArchiveFinalizations.downloadId,
                    ids.slice(offset, offset + 500)
                )
            );
        for (const row of rows) {
            const proof = parseArchiveFinalization(row.proof);
            if (proof) result.set(row.downloadId, proof);
        }
    }
    return result;
}

export function verifiedArchiveSize(
    filePath: string | null,
    proof: ArchiveFinalizationProof | undefined
): number | null {
    if (!proof || proof.filePath !== filePath) return null;
    try {
        const file = lstatSync(proof.filePath);
        return file.isFile() &&
            file.dev === proof.finalIdentity.dev &&
            file.ino === proof.finalIdentity.ino &&
            file.size === proof.size
            ? proof.size
            : null;
    } catch {
        return null;
    }
}

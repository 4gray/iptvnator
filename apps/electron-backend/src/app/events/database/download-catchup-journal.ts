import { cleanupArchiveCapture } from './download-catchup-capture';
import { eq, inArray } from 'drizzle-orm';
import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import * as schema from '../../database/schema';
import type { ArchiveFileIdentity } from './download-catchup-output';
import type { DownloadsDatabase } from './download-task';

export interface ArchiveFinalizationProof {
    version: 1;
    phase?: 'finalization';
    filePath: string;
    size: number;
    partialIdentity: ArchiveFileIdentity;
    partialCleanupPath?: string;
    finalIdentity: ArchiveFileIdentity;
}

export interface ArchivePartialProof {
    version: 1;
    phase: 'transfer';
    filePath: string;
    partialIdentity: ArchiveFileIdentity;
    partialCleanupPath?: string;
}
export type ArchiveDownloadProof =
    ArchiveFinalizationProof | ArchivePartialProof;

export async function recordArchivePartial(
    db: DownloadsDatabase,
    downloadId: number,
    filePath: string,
    partialIdentity: ArchiveFileIdentity
): Promise<void> {
    await writeArchiveProof(db, downloadId, {
        version: 1,
        phase: 'transfer',
        filePath,
        partialIdentity,
    });
}

export async function recordArchiveFinalization(
    db: DownloadsDatabase,
    downloadId: number,
    proof: ArchiveFinalizationProof
): Promise<void> {
    await writeArchiveProof(db, downloadId, proof);
}

async function writeArchiveProof(
    db: DownloadsDatabase,
    downloadId: number,
    proof: ArchiveDownloadProof
): Promise<void> {
    const serialized = JSON.stringify({
        ...proof,
        partialIdentity: {
            dev: proof.partialIdentity.dev,
            ino: proof.partialIdentity.ino,
        },
        ...(proof.phase !== 'transfer'
            ? {
                  finalIdentity: {
                      dev: proof.finalIdentity.dev,
                      ino: proof.finalIdentity.ino,
                  },
              }
            : {}),
    });
    await db
        .insert(schema.downloadArchiveFinalizations)
        .values({ downloadId, proof: serialized })
        .onConflictDoUpdate({
            target: schema.downloadArchiveFinalizations.downloadId,
            set: { proof: serialized },
        });
}

/** Commit the recovery pointer synchronously before a public entry is captured. */
export function recordArchiveCleanupPath(
    db: DownloadsDatabase,
    downloadId: number,
    proof: ArchiveDownloadProof,
    path: string
): void {
    const result = db
        .update(schema.downloadArchiveFinalizations)
        .set({ proof: JSON.stringify({ ...proof, partialCleanupPath: path }) })
        .where(eq(schema.downloadArchiveFinalizations.downloadId, downloadId))
        .run();
    if (result.changes !== 1)
        throw new Error('Archive cleanup ownership is unavailable');
}

/** Fresh reservations must never inherit an earlier attempt's proof. */
export async function clearArchiveFinalization(
    db: DownloadsDatabase,
    downloadId: number
): Promise<void> {
    cleanupArchiveCapture(
        (await readArchiveFinalizations(db, [downloadId])).get(downloadId)
    );
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
): ArchiveDownloadProof | undefined {
    try {
        const proof = JSON.parse(value) as ArchiveDownloadProof;
        if (
            !proof ||
            proof.version !== 1 ||
            typeof proof.filePath !== 'string' ||
            !isAbsolute(proof.filePath) ||
            !identity(proof.partialIdentity) ||
            (proof.partialCleanupPath !== undefined &&
                (typeof proof.partialCleanupPath !== 'string' ||
                    !isAbsolute(proof.partialCleanupPath)))
        )
            return undefined;
        if (proof.phase === 'transfer') return proof;
        return (proof.phase === undefined || proof.phase === 'finalization') &&
            Number.isSafeInteger(proof.size) &&
            proof.size > 0 &&
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
): Promise<Map<number, ArchiveDownloadProof>> {
    if (ids.length === 0) return new Map();
    const result = new Map<number, ArchiveDownloadProof>();
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
    proof: ArchiveDownloadProof | undefined
): number | null {
    if (!proof || proof.phase === 'transfer' || proof.filePath !== filePath)
        return null;
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

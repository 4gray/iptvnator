import { readArchiveStatsSync } from './download-catchup-stats';
import { cleanupArchiveCapture } from './download-catchup-capture';
import { eq, inArray, sql } from 'drizzle-orm';
import { isAbsolute } from 'node:path';
import * as schema from '../../database/schema';
import {
    archiveFileIdentity,
    isArchiveFileId,
    sameArchiveFileIdentity,
    type ArchiveFileIdentity,
} from './download-catchup-output';
import type { DownloadsDatabase } from './download-task';

export interface ArchiveFinalizationProof {
    version: 1;
    phase?: 'finalization';
    filePath: string;
    size: number;
    partialIdentity: ArchiveFileIdentity;
    partialCleanupPath?: string;
    finalCleanupPath?: string;
    finalIdentity: ArchiveFileIdentity;
}

export interface ArchivePartialProof {
    version: 1;
    phase: 'transfer';
    filePath: string;
    partialIdentity: ArchiveFileIdentity;
    partialCleanupPath?: string;
    finalCleanupPath?: string;
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

/** The row path and its ownership proof must become recoverable together. */
export async function recordArchiveReservation(
    db: DownloadsDatabase,
    downloadId: number,
    filePath: string,
    partialIdentity: ArchiveFileIdentity,
    fileName: string
): Promise<void> {
    db.transaction((tx) => {
        const result = tx
            .update(schema.downloads)
            .set({
                filePath,
                fileName,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(schema.downloads.id, downloadId))
            .run();
        if (result.changes !== 1)
            throw new Error('Archive reservation row is unavailable');
        writeArchiveProof(tx, downloadId, {
            version: 1,
            phase: 'transfer',
            filePath,
            partialIdentity,
        }).run();
    });
}

export async function recordArchiveFinalization(
    db: DownloadsDatabase,
    downloadId: number,
    proof: ArchiveFinalizationProof
): Promise<void> {
    await writeArchiveProof(db, downloadId, proof);
}

function writeArchiveProof(
    db: Pick<DownloadsDatabase, 'insert'>,
    downloadId: number,
    proof: ArchiveDownloadProof
) {
    const serialized = JSON.stringify({
        ...proof,
        partialIdentity: archiveFileIdentity(proof.partialIdentity),
        ...(proof.phase !== 'transfer'
            ? {
                  finalIdentity: archiveFileIdentity(proof.finalIdentity),
              }
            : {}),
    });
    return db
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
    path: string,
    kind: 'partial' | 'final' = 'partial'
): void {
    const result = db
        .update(schema.downloadArchiveFinalizations)
        .set({
            proof: JSON.stringify({
                ...proof,
                [kind === 'partial'
                    ? 'partialCleanupPath'
                    : 'finalCleanupPath']: path,
            }),
        })
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
        isArchiveFileId(candidate.dev) &&
        isArchiveFileId(candidate.ino) &&
        Number.isFinite(candidate.birthtimeMs) &&
        candidate.birthtimeMs > 0
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
        if (
            proof.finalCleanupPath !== undefined &&
            (typeof proof.finalCleanupPath !== 'string' ||
                !isAbsolute(proof.finalCleanupPath))
        )
            return undefined;
        if (proof.phase === 'transfer')
            return proof.finalCleanupPath === undefined ? proof : undefined;
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
        const file = readArchiveStatsSync(proof.filePath);
        return file.isFile() &&
            sameArchiveFileIdentity(file, proof.finalIdentity) &&
            file.size === proof.size
            ? proof.size
            : null;
    } catch {
        return null;
    }
}

import type BetterSqlite3 from 'better-sqlite3';
import type { ParsedChannel, ParsedProgram } from './epg-streaming-parser';

type StagingTable = 'epg_import_channels' | 'epg_import_programmes';
type StagedRow = { sequence: number; payload: string };

/** Keeps streamed batches off the live guide until the entire XML is valid. */
export class EpgImportStaging {
    private committed = false;
    private readonly stageChannels: (rows: ParsedChannel[]) => void;
    private readonly stageProgrammes: (rows: ParsedProgram[]) => void;

    constructor(
        private readonly db: BetterSqlite3.Database,
        private readonly applyChannels: (
            rows: ParsedChannel[],
            clear: boolean
        ) => void,
        private readonly applyProgrammes: (rows: ParsedProgram[]) => void
    ) {
        // Connection-private, file-backed tables keep JS memory bounded and
        // hold no live-database write lock while the source is downloading.
        db.pragma('temp_store = FILE');
        db.pragma('temp.cache_size = -2048');
        db.exec(`
            CREATE TEMP TABLE epg_import_channels (
                sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL
            );
            CREATE TEMP TABLE epg_import_programmes (
                sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL
            );
        `);
        this.stageChannels = this.createWriter('epg_import_channels');
        this.stageProgrammes = this.createWriter('epg_import_programmes');
    }

    insertChannels(rows: ParsedChannel[]): void {
        this.assertPending();
        this.stageChannels(rows);
    }

    insertPrograms(rows: ParsedProgram[]): void {
        this.assertPending();
        this.stageProgrammes(rows);
    }

    commit(): void {
        this.assertPending();
        this.db.transaction(() => {
            let clear = true;
            this.readBatches<ParsedChannel>(
                'epg_import_channels',
                100,
                (rows) => {
                    this.applyChannels(rows, clear);
                    clear = false;
                }
            );
            this.readBatches<ParsedProgram>(
                'epg_import_programmes',
                1000,
                (rows) => this.applyProgrammes(rows)
            );
        })();
        this.committed = true;
        // Closing the owning connection discards all temporary rows, including
        // after a parse error, failed commit or worker termination.
    }

    private createWriter<T>(table: StagingTable): (rows: T[]) => void {
        const insert = this.db.prepare(
            `INSERT INTO ${table} (payload) VALUES (?)`
        );
        return this.db.transaction((rows: T[]) => {
            for (const row of rows) insert.run(JSON.stringify(row));
        });
    }

    private readBatches<T>(
        table: StagingTable,
        limit: number,
        apply: (rows: T[]) => void
    ): void {
        const select = this.db.prepare(`
            SELECT sequence, payload FROM ${table}
            WHERE sequence > ? ORDER BY sequence LIMIT ?
        `);
        let sequence = 0;
        for (;;) {
            const rows = select.all(sequence, limit) as StagedRow[];
            if (rows.length === 0) return;
            apply(rows.map((row) => JSON.parse(row.payload) as T));
            sequence = rows[rows.length - 1].sequence;
        }
    }

    private assertPending(): void {
        if (this.committed) throw new Error('EPG import has already committed');
    }
}

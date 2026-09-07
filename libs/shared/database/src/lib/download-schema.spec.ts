import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

it('migrates existing downloads without losing files and separates programme identities', () => {
    const electron = createRequire(__filename)('electron') as string;
    const moduleUrl = pathToFileURL(
        resolve(__dirname, 'download-schema.ts')
    ).href;
    const result = execFileSync(
        electron,
        [
            '--import',
            'tsx',
            '--eval',
            `
        const { default: Database } = await import('better-sqlite3');
        const { DOWNLOADS_TABLE_SQL, ensureDownloadsCatchupSchema } = await import(${JSON.stringify(moduleUrl)});
        const db = new Database(':memory:');
        db.pragma('foreign_keys = ON');
        db.exec(DOWNLOADS_TABLE_SQL.replace(", 'catchup'", '').replace('programme_start INTEGER NOT NULL DEFAULT 0,', '').replace('catchup TEXT,', ''));
        db.exec("CREATE UNIQUE INDEX downloads_xtream_playlist_unique ON downloads(xtream_id, playlist_id, content_type)");
        db.prepare("INSERT INTO downloads (id,playlist_id,xtream_id,content_type,title,url,status,file_path,bytes_downloaded,resume_validator,request_headers) VALUES (42,'p',1,'vod','Movie','https://host/movie','paused','/safe/movie.mp4',123,'etag','headers')").run();
        ensureDownloadsCatchupSchema(db);
        ensureDownloadsCatchupSchema(db);
        const insert = db.prepare("INSERT INTO downloads (playlist_id,xtream_id,content_type,programme_start,title,url) VALUES ('p',1,?,?, 'Show','https://host/archive')");
        insert.run('catchup', 1000); insert.run('catchup', 2000);
        let duplicateArchive = false, duplicateMovie = false;
        try { insert.run('catchup', 1000); } catch { duplicateArchive = true; }
        try { insert.run('vod', 0); } catch { duplicateMovie = true; }
        db.prepare("INSERT INTO downloads (id,playlist_id,xtream_id,content_type,title,url) VALUES (999,'p',99,'catchup','Proof','https://host/archive')").run();
        db.prepare("INSERT INTO download_archive_finalizations (download_id,proof) VALUES (999,'{}')").run();
        db.prepare('DELETE FROM downloads WHERE id=999').run();
        const journalCount = db.prepare('SELECT count(*) AS n FROM download_archive_finalizations').get().n;
        process.stdout.write(JSON.stringify({journalCount,row:db.prepare('SELECT * FROM downloads WHERE id=42').get(), count:db.prepare('SELECT count(*) AS n FROM downloads').get().n, duplicateArchive,duplicateMovie}));
    `,
        ],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                TSX_TSCONFIG_PATH: resolve(process.cwd(), 'tsconfig.base.json'),
            },
        }
    );
    expect(JSON.parse(result)).toMatchObject({
        count: 3,
        journalCount: 0,
        duplicateArchive: true,
        duplicateMovie: true,
        row: {
            id: 42,
            status: 'paused',
            file_path: '/safe/movie.mp4',
            bytes_downloaded: 123,
            resume_validator: 'etag',
            request_headers: 'headers',
            programme_start: 0,
            catchup: null,
        },
    });
});

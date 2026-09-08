import {
    createDownloadRow,
    getHandler,
    mockBroadcastDownloadUpdate,
    mockDownloadRow,
    mockRemoveDownloadFromRuntime,
    mockIsDownloadCommitting,
    mockHasRuntimeDownload,
    mockPrepareArchiveRemoval,
    mockRemoveJournaledPartial,
    mockArchiveProofs,
    mockVerifiedArchiveSize,
    mockRecordArchiveCleanupPath,
    mockRemovePartialDownloadFile,
    mockTerminalRows,
    setupDownloadsEventsHarness,
} from './downloads.test-helpers';

describe('downloads events: partial-file cleanup', () => {
    beforeEach(async () => {
        await setupDownloadsEventsHarness();
    });

    it.each(['remove', 'clear'])(
        'returns a recoverable path and retains the row on %s',
        async (action) => {
            const { ArchiveRecoveryRequiredError } =
                await import('./download-catchup-capture');
            const row = {
                ...createDownloadRow('failed'),
                contentType: 'catchup',
            };
            const { deleteWhere } =
                action === 'remove'
                    ? mockDownloadRow(row)
                    : mockTerminalRows([row]);
            const recoveryPath = '/downloads/.iptvnator-cleanup-test/entry';
            mockRemoveJournaledPartial.mockImplementation(() => {
                throw new ArchiveRecoveryRequiredError(recoveryPath);
            });
            const consoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            try {
                const result =
                    action === 'remove'
                        ? await getHandler('DOWNLOADS_REMOVE')(null, 42)
                        : await getHandler('DOWNLOADS_CLEAR_COMPLETED')(null);
                expect(result).toMatchObject({ success: false, recoveryPath });
                expect(deleteWhere).not.toHaveBeenCalled();
                expect(mockRemoveDownloadFromRuntime).not.toHaveBeenCalled();
            } finally {
                consoleError.mockRestore();
            }
        }
    );

    it('waits for active archive cancellation before reading or deleting the row', async () => {
        const { db, deleteWhere } = mockDownloadRow(
            createDownloadRow('canceled')
        );
        let release!: (ready: boolean) => void;
        mockPrepareArchiveRemoval.mockReturnValue(
            new Promise<boolean>((resolve) => {
                release = resolve;
            })
        );
        const remove = getHandler('DOWNLOADS_REMOVE')(null, 42);
        expect(db.select).not.toHaveBeenCalled();
        expect(deleteWhere).not.toHaveBeenCalled();
        release(true);
        await expect(remove).resolves.toEqual({ success: true });
    });

    it('rejects Remove before reading storage when completion already owns the task', async () => {
        const { db, deleteWhere } = mockDownloadRow(
            createDownloadRow('downloading')
        );
        mockPrepareArchiveRemoval.mockResolvedValue(false);
        await expect(
            getHandler('DOWNLOADS_REMOVE')(null, 42)
        ).resolves.toMatchObject({ success: false });
        expect(db.select).not.toHaveBeenCalled();
        expect(deleteWhere).not.toHaveBeenCalled();
    });

    it('keeps a new archive attempt that starts while Remove reads storage', async () => {
        const { deleteWhere } = mockDownloadRow({
            ...createDownloadRow('failed'),
            contentType: 'catchup',
        });
        mockHasRuntimeDownload.mockReturnValue(true);
        await expect(
            getHandler('DOWNLOADS_REMOVE')(null, 42)
        ).resolves.toMatchObject({ success: false });
        expect(mockRemoveJournaledPartial).not.toHaveBeenCalled();
        expect(deleteWhere).not.toHaveBeenCalled();
    });

    it('preserves completed archive media when removing its library row', async () => {
        mockDownloadRow({
            ...createDownloadRow('completed'),
            contentType: 'catchup',
        });
        await expect(getHandler('DOWNLOADS_REMOVE')(null, 42)).resolves.toEqual(
            { success: true }
        );
        expect(mockRemoveJournaledPartial).toHaveBeenCalledWith(
            '/downloads/resume.mp4',
            undefined,
            expect.any(Function),
            false
        );
    });

    it.each([false, true])(
        'retries settled archive cleanup despite a failed cancellation status write (locked=%s)',
        async (locked) => {
            const { deleteWhere } = mockDownloadRow({
                ...createDownloadRow('downloading'),
                contentType: 'catchup',
            });
            const proof = {
                version: 1,
                phase: 'transfer',
                partialCleanupPath: '/downloads/.iptvnator-cleanup-test/entry',
            };
            mockArchiveProofs.mockResolvedValue(new Map([[42, proof]]));
            if (locked)
                mockRemoveJournaledPartial.mockImplementation(() => {
                    throw new Error('EACCES');
                });
            await expect(
                getHandler('DOWNLOADS_REMOVE')(null, 42)
            ).resolves.toMatchObject({ success: !locked });
            expect(mockRemoveJournaledPartial).toHaveBeenCalledWith(
                '/downloads/resume.mp4',
                proof,
                expect.any(Function),
                true
            );
            if (locked) expect(deleteWhere).not.toHaveBeenCalled();
            else expect(deleteWhere).toHaveBeenCalled();
        }
    );

    it.each(['remove', 'clear'])(
        'preserves a proven completed archive after failed status writes on %s',
        async (action) => {
            const proof = { version: 1, phase: 'finalization', size: 188 };
            const id = action === 'remove' ? 42 : 1;
            const row = {
                ...createDownloadRow(
                    action === 'remove' ? 'downloading' : 'failed'
                ),
                contentType: 'catchup',
            };
            if (action === 'remove') mockDownloadRow(row);
            else mockTerminalRows([row]);
            mockArchiveProofs.mockResolvedValue(new Map([[id, proof]]));
            mockVerifiedArchiveSize.mockReturnValue(188);
            const result =
                action === 'remove'
                    ? getHandler('DOWNLOADS_REMOVE')(null, id)
                    : getHandler('DOWNLOADS_CLEAR_COMPLETED')(null);
            await expect(result).resolves.toEqual({ success: true });
            expect(mockVerifiedArchiveSize).toHaveBeenCalledWith(
                row.filePath,
                proof
            );
            expect(mockRemoveJournaledPartial).toHaveBeenCalledWith(
                row.filePath,
                proof,
                expect.any(Function),
                false
            );
        }
    );

    it('keeps a committing archive row and journal intact on Remove', async () => {
        const { deleteWhere } = mockDownloadRow(
            createDownloadRow('downloading')
        );
        mockIsDownloadCommitting.mockReturnValue(true);
        await expect(getHandler('DOWNLOADS_REMOVE')(null, 42)).resolves.toEqual(
            {
                success: false,
                error: 'Download is completing; try again shortly',
            }
        );
        expect(mockRemovePartialDownloadFile).not.toHaveBeenCalled();
        expect(mockRemoveDownloadFromRuntime).not.toHaveBeenCalled();
        expect(deleteWhere).not.toHaveBeenCalled();
    });

    it('skips completion commits when clearing terminal rows', async () => {
        const { deleteWhere } = mockTerminalRows([
            createDownloadRow('completed'),
        ]);
        mockHasRuntimeDownload.mockReturnValue(true);
        await expect(
            getHandler('DOWNLOADS_CLEAR_COMPLETED')(null)
        ).resolves.toEqual({ success: true });
        expect(mockRemovePartialDownloadFile).not.toHaveBeenCalled();
        expect(deleteWhere).not.toHaveBeenCalled();
    });

    it('routes archive Remove through durable cleanup instead of pathname unlink', async () => {
        const { deleteWhere } = mockDownloadRow({
            ...createDownloadRow('failed'),
            contentType: 'catchup',
        });
        const proof = { version: 1, phase: 'transfer' };
        mockRemoveJournaledPartial.mockImplementation((_path, _proof, record) =>
            record('/downloads/.iptvnator-cleanup-test/entry', 'partial')
        );
        mockArchiveProofs.mockResolvedValue(new Map([[42, proof]]));
        await expect(getHandler('DOWNLOADS_REMOVE')(null, 42)).resolves.toEqual(
            { success: true }
        );
        expect(mockRemoveJournaledPartial).toHaveBeenCalledWith(
            '/downloads/resume.mp4',
            proof,
            expect.any(Function),
            true
        );
        expect(mockRemovePartialDownloadFile).not.toHaveBeenCalled();
        expect(mockRecordArchiveCleanupPath).toHaveBeenCalledWith(
            expect.anything(),
            42,
            proof,
            '/downloads/.iptvnator-cleanup-test/entry',
            'partial'
        );
        expect(deleteWhere).toHaveBeenCalled();
    });

    it('routes archive Clear completed through durable cleanup', async () => {
        mockTerminalRows([
            { ...createDownloadRow('canceled'), contentType: 'catchup' },
        ]);
        const proof = { version: 1, phase: 'transfer' };
        mockRemoveJournaledPartial.mockImplementation((_path, _proof, record) =>
            record('/downloads/.iptvnator-cleanup-test/entry', 'partial')
        );
        mockArchiveProofs.mockResolvedValue(new Map([[1, proof]]));
        await expect(
            getHandler('DOWNLOADS_CLEAR_COMPLETED')(null)
        ).resolves.toEqual({ success: true });
        expect(mockRemoveJournaledPartial).toHaveBeenCalledWith(
            '/downloads/resume.mp4',
            proof,
            expect.any(Function),
            true
        );
        expect(mockRecordArchiveCleanupPath).toHaveBeenCalledWith(
            expect.anything(),
            1,
            proof,
            '/downloads/.iptvnator-cleanup-test/entry',
            'partial'
        );
        expect(mockRemovePartialDownloadFile).not.toHaveBeenCalled();
    });

    it('removes queued resumed partial files before deleting the row', async () => {
        const { deleteWhere } = mockDownloadRow(createDownloadRow('queued'));

        await expect(getHandler('DOWNLOADS_REMOVE')(null, 42)).resolves.toEqual(
            {
                success: true,
            }
        );

        expect(mockRemoveDownloadFromRuntime).toHaveBeenCalledWith(42);
        expect(mockRemovePartialDownloadFile).toHaveBeenCalledWith(
            '/downloads/resume.mp4'
        );
        expect(
            mockRemovePartialDownloadFile.mock.invocationCallOrder[0]
        ).toBeLessThan(
            mockRemoveDownloadFromRuntime.mock.invocationCallOrder[0]
        );
        expect(
            mockRemovePartialDownloadFile.mock.invocationCallOrder[0]
        ).toBeLessThan(deleteWhere.mock.invocationCallOrder[0]);
        expect(mockBroadcastDownloadUpdate).toHaveBeenCalledTimes(1);
    });

    it('removes completed partial files before deleting the row', async () => {
        const { deleteWhere } = mockDownloadRow(createDownloadRow('completed'));

        await expect(getHandler('DOWNLOADS_REMOVE')(null, 42)).resolves.toEqual(
            {
                success: true,
            }
        );

        expect(mockRemovePartialDownloadFile).toHaveBeenCalledWith(
            '/downloads/resume.mp4'
        );
        expect(
            mockRemovePartialDownloadFile.mock.invocationCallOrder[0]
        ).toBeLessThan(deleteWhere.mock.invocationCallOrder[0]);
    });

    it('keeps the queued runtime entry and row when partial cleanup fails', async () => {
        const cleanupError = new Error('permission denied');
        const { deleteWhere } = mockDownloadRow(createDownloadRow('queued'));
        mockRemovePartialDownloadFile.mockImplementation(() => {
            throw cleanupError;
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const consoleLog = jest
            .spyOn(console, 'log')
            .mockImplementation(() => undefined);

        try {
            // The row and its .part must survive, but the renderer gets a
            // structured failure it can surface instead of an IPC rejection.
            await expect(
                getHandler('DOWNLOADS_REMOVE')(null, 42)
            ).resolves.toEqual({
                error: 'Could not delete the partial file',
                success: false,
            });
        } finally {
            consoleError.mockRestore();
            consoleLog.mockRestore();
        }

        expect(deleteWhere).not.toHaveBeenCalled();
        expect(mockRemoveDownloadFromRuntime).not.toHaveBeenCalled();
    });

    it('removes completed, failed, and canceled partial files before clearing terminal downloads', async () => {
        const { deleteWhere } = mockTerminalRows([
            { filePath: '/downloads/done.mp4', status: 'completed' },
            { filePath: '/downloads/failed.mp4', status: 'failed' },
            { filePath: '/downloads/canceled.mp4', status: 'canceled' },
        ]);

        await expect(
            getHandler('DOWNLOADS_CLEAR_COMPLETED')(null)
        ).resolves.toEqual({ success: true });

        expect(mockRemovePartialDownloadFile).toHaveBeenCalledTimes(3);
        expect(mockRemovePartialDownloadFile).toHaveBeenNthCalledWith(
            1,
            '/downloads/done.mp4'
        );
        expect(mockRemovePartialDownloadFile).toHaveBeenNthCalledWith(
            2,
            '/downloads/failed.mp4'
        );
        expect(mockRemovePartialDownloadFile).toHaveBeenNthCalledWith(
            3,
            '/downloads/canceled.mp4'
        );
        expect(
            mockRemovePartialDownloadFile.mock.invocationCallOrder[0]
        ).toBeLessThan(deleteWhere.mock.invocationCallOrder[0]);
        expect(mockBroadcastDownloadUpdate).toHaveBeenCalledTimes(1);
    });

    it('retains only downloads whose partial cleanup fails when clearing terminal downloads', async () => {
        const cleanupError = new Error('permission denied');
        const { deleteWhere } = mockTerminalRows([
            { filePath: '/downloads/done.mp4', status: 'completed' },
            { filePath: '/downloads/failed.mp4', status: 'failed' },
        ]);
        mockRemovePartialDownloadFile.mockImplementation((filePath) => {
            if (filePath !== '/downloads/failed.mp4') {
                return;
            }
            throw cleanupError;
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            await expect(
                getHandler('DOWNLOADS_CLEAR_COMPLETED')(null)
            ).resolves.toEqual({ success: true });
        } finally {
            consoleError.mockRestore();
        }

        expect(deleteWhere).toHaveBeenCalledTimes(1);
        expect(mockBroadcastDownloadUpdate).toHaveBeenCalledTimes(1);
    });

    it('removes the row once a previously locked partial becomes deletable', async () => {
        const { deleteWhere } = mockDownloadRow(createDownloadRow('paused'));
        mockRemovePartialDownloadFile
            .mockImplementationOnce(() => {
                throw new Error('EPERM: locked');
            })
            .mockImplementation(() => true);
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const consoleLog = jest
            .spyOn(console, 'log')
            .mockImplementation(() => undefined);

        try {
            await expect(
                getHandler('DOWNLOADS_REMOVE')(null, 42)
            ).resolves.toEqual({
                error: 'Could not delete the partial file',
                success: false,
            });
            expect(deleteWhere).not.toHaveBeenCalled();

            // Retry after the lock is released: cleanup and delete succeed.
            await expect(
                getHandler('DOWNLOADS_REMOVE')(null, 42)
            ).resolves.toEqual({ success: true });
        } finally {
            consoleError.mockRestore();
            consoleLog.mockRestore();
        }

        expect(mockRemovePartialDownloadFile).toHaveBeenCalledTimes(2);
        expect(deleteWhere).toHaveBeenCalledTimes(1);
    });
});

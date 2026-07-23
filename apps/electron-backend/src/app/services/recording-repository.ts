import type {
    PersistedRecordingItem,
    PersistedRecordingUpdate,
    RecordingStatus,
    ScheduleRecordingRequest,
} from '@iptvnator/shared/interfaces';
import { initDatabase } from '../database/connection';
import { databaseWorkerClient } from './database-worker-client';

export interface RecordingRepository {
    create(
        id: string,
        request: ScheduleRecordingRequest
    ): Promise<PersistedRecordingItem>;
    get(id: string): Promise<PersistedRecordingItem | null>;
    list(statuses?: RecordingStatus[]): Promise<PersistedRecordingItem[]>;
    update(
        id: string,
        update: PersistedRecordingUpdate
    ): Promise<PersistedRecordingItem | null>;
    delete(id: string): Promise<{ success: boolean }>;
}

export class WorkerRecordingRepository implements RecordingRepository {
    constructor(
        private readonly waitForDatabase: () => Promise<unknown> = () =>
            initDatabase()
    ) {}

    async create(
        id: string,
        request: ScheduleRecordingRequest
    ): Promise<PersistedRecordingItem> {
        await this.waitForDatabase();
        return databaseWorkerClient.request('DB_CREATE_RECORDING', {
            id,
            request,
        });
    }

    async get(id: string): Promise<PersistedRecordingItem | null> {
        await this.waitForDatabase();
        return databaseWorkerClient.request('DB_GET_RECORDING', { id });
    }

    async list(
        statuses?: RecordingStatus[]
    ): Promise<PersistedRecordingItem[]> {
        await this.waitForDatabase();
        return databaseWorkerClient.request('DB_LIST_RECORDINGS', {
            statuses,
        });
    }

    async update(
        id: string,
        update: PersistedRecordingUpdate
    ): Promise<PersistedRecordingItem | null> {
        await this.waitForDatabase();
        return databaseWorkerClient.request('DB_UPDATE_RECORDING', {
            id,
            update,
        });
    }

    async delete(id: string): Promise<{ success: boolean }> {
        await this.waitForDatabase();
        return databaseWorkerClient.request('DB_DELETE_RECORDING', { id });
    }
}

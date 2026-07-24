import type { DownloadTask } from './download-task';

export function createTask(): DownloadTask {
    return {
        directory: '/downloads',
        fileName: 'movie.mp4',
        id: 42,
        url: 'https://example.test/movie.mp4',
    };
}

export async function waitForCallCount(
    mock: jest.Mock,
    expectedCallCount: number
): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
        if (mock.mock.calls.length === expectedCallCount) {
            return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(mock).toHaveBeenCalledTimes(expectedCallCount);
}

export async function waitForStatus(
    set: jest.Mock,
    status: string
): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
        if (set.mock.calls.some(([value]) => value?.status === status)) {
            return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status }));
}

export async function waitForStatusCount(
    set: jest.Mock,
    status: string,
    expectedCount: number
): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
        const statusCount = set.mock.calls.filter(
            ([value]) => value?.status === status
        ).length;
        if (statusCount >= expectedCount) {
            return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(
        set.mock.calls.filter(([value]) => value?.status === status)
    ).toHaveLength(expectedCount);
}

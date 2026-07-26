import { test } from '@playwright/test';

import { runM3uRefreshCancellationBenchmark } from './performance/m3u-refresh-cancellation.benchmark';

// eslint-disable-next-line playwright/expect-expect -- Assertions run inside the shared benchmark lifecycle.
test('profiles cancellation of a 100k M3U refresh', async () => {
    await runM3uRefreshCancellationBenchmark();
});

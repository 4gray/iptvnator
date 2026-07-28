import { test } from '@playwright/test';

import { runM3uImportBenchmark } from './performance/m3u-import.benchmark';

// eslint-disable-next-line playwright/expect-expect -- Assertions run inside the shared benchmark lifecycle.
test('profiles initial M3U imports at 10k, 50k, and 100k', async () => {
    await runM3uImportBenchmark();
});

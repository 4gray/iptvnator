import { test } from '@playwright/test';

import { runXtreamBenchmark } from './performance/xtream-benchmark-orchestrator';

test('profiles the synthetic 100k Xtream workflows', async () => {
    await runXtreamBenchmark();
});

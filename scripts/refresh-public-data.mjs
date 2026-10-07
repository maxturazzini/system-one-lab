import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchDataset, getDatasetCatalog } from '../src/datasets.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const target = join(ROOT, 'samples', 'public-snapshot.json');

// Otto record da ogni dataset presente in datasets/. Una fonte che non risponde non blocca le altre.
const catalog = await getDatasetCatalog();
const results = await Promise.allSettled(catalog.map(dataset => fetchDataset(dataset.id, { limit: 8 })));

const datasets = {};
let recordCount = 0;
results.forEach((result, index) => {
  const { id } = catalog[index];
  if (result.status === 'fulfilled') {
    datasets[id] = result.value;
    recordCount += result.value.records.length;
  } else {
    datasets[id] = { error: result.reason?.message ?? String(result.reason) };
    console.warn(`${id}: ${datasets[id].error}`);
  }
});

await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify({ generatedAt: new Date().toISOString(), datasets }, null, 2)}\n`);
console.log(`Saved ${recordCount} public records from ${catalog.length} datasets to ${target}`);

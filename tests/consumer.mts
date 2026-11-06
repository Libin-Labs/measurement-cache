import {
  createMeasurementCache,
  type MeasurementCache,
  type Measurement,
} from '@lp-labs/measurement-cache';
const cache: MeasurementCache = createMeasurementCache((keys) =>
  keys.map((key) => ({ key, width: 1, height: 2 })),
);
const results: Measurement[] = cache.read(['a']);
// @ts-expect-error synchronous measurement adapters cannot return a promise.
createMeasurementCache(async () => []);
// @ts-expect-error dimensions are numeric.
cache.set('a', { width: '1', height: 2 });
void results;

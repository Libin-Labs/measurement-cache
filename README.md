# @lp-labs/measurement-cache

Bounded LRU measurement caching with synchronous batch adapters and atomic cache updates.
Independent, framework-neutral implementation with zero runtime or peer dependencies.
No DOM/browser API is accessed on import or implicitly.

## Install

```bash
npm install @lp-labs/measurement-cache
```

ES2022 ESM/CommonJS and TypeScript declarations.
CommonJS: `const { createMeasurementCache } = require('@lp-labs/measurement-cache')`.

## Quickstart

```js
import { createMeasurementCache } from '@lp-labs/measurement-cache';

let batches = 0;
const cache = createMeasurementCache((keys) => {
  batches++;
  return keys.map((key) => ({ key, width: 120, height: 24 }));
});
const first = cache.read(['row-a', 'row-b', 'row-a']);
cache.read(['row-b']);
if (first.length !== 2 || batches !== 1) throw new Error('Measurements were not reused');
cache.invalidate(['row-b']);
cache.read(['row-b']);
if (batches !== 2) throw new Error('Invalidated measurement was not refreshed');
```

## API

`createMeasurementCache(measure: MeasureBatch, options?: CacheOptions): MeasurementCache`

`measure(keys: readonly string[]): Iterable<Measurement>` receives a frozen array of **only
missing keys**, in first-request order. It must return every missing key exactly once.
Output order may differ. Unknown/duplicate/missing outputs throw, not partially populate the cache.
Adapters and their iterators must be synchronous; promises/async iterables are not accepted.

`Size` is `{ width: number, height: number }`; dimensions must be finite and non-negative.
`Measurement` adds `key: string`. Keys are nonempty strings up to 1024 UTF-16 units.
Measurements are copied; caller mutation cannot change cached values.

Options are positive safe integers:

- `maxEntries = 10000`: maximum retained measurements.
- `maxBatch = 10000`: maximum **input occurrences**, including duplicates, per read/invalidation.

| Member                                        | Contract                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `read(keys: Iterable<string>): Measurement[]` | Deduplicate keys in first-request order, measure misses in one adapter call, return all requested unique measurements and touch LRU order. |
| `peek(key): Measurement \| null`              | Independent cached measurement or `null`; does not touch recency or measure.                                                               |
| `set(key, size)`                              | Insert/replace a validated measurement and make it most recent.                                                                            |
| `invalidate(keys?)`                           | Validate input first, delete requested unique keys and return removed count; omitted keys clears all.                                      |
| `snapshot()`                                  | Independent measurements ordered least-recent to most-recent; no recency change.                                                           |
| `size`                                        | Current retained count.                                                                                                                    |

The last unique key in a successful read is most recent. A read larger than `maxEntries`
still returns **all** requested measurements, while retaining only the most-recent entries.
An empty read never calls the adapter.

## DOM integration and invalidation

Use your own stable key-to-element map inside the adapter and perform the batch at an appropriate
read phase in your render scheduler. The library does not schedule animation frames.
After content, fonts, zoom or layout changes, invalidate affected keys before reading again.
Connect `ResizeObserver` yourself when needed, and disconnect it on teardown.

```js
import { createMeasurementCache } from '@lp-labs/measurement-cache';

const sizes = new Map([['panel', { width: 400, height: 200 }]]);
const cache = createMeasurementCache(
  (keys) =>
    keys.map((key) => {
      const size = sizes.get(key);
      if (!size) throw new Error(`Unknown measurement source: ${key}`);
      return { key, ...size };
    }),
  { maxEntries: 100, maxBatch: 50 },
);
cache.read(['panel']);
sizes.set('panel', { width: 420, height: 200 });
cache.invalidate(['panel']);
if (cache.read(['panel'])[0].width !== 420) throw new Error('Stale measurement');
```

## Atomicity and errors

If key iteration, measurement iteration or output validation fails, cache contents **and recency**
remain unchanged. Adapter side effects and actual DOM measurements are not rolled back.
All cache operations, including introspection, reject reentrancy while reading/invalidating or
validating a `set` size. Size getters are read once; trusted adapters should return simple data.

Invalid keys/dimensions/output contracts throw `TypeError`; unsafe/exceeded capacities throw
`RangeError`. Adapter errors propagate unchanged. No default zero measurements conceal failure.
Never use a stale key for a different object without invalidating it.

## Performance and scope

`peek`, `set` and per-key invalidation are average O(1). A successful read copies the retained
Map to preserve atomic recency updates: O(N + B) time and temporary memory, plus adapter work.
Snapshots cost O(N). Persistent memory is O(N), with N retained entries and B batch occurrences.

No automatic ResizeObserver, DOM ownership, asynchronous coalescing, persistence, scroll anchoring,
virtualization or framework rendering adapter is included. This cache stores width/height only.
Exported types: `Size`, `Measurement`, `MeasureBatch`, `CacheOptions`, `MeasurementCache`.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.

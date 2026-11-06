import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createMeasurementCache } from '../dist/esm/index.js';
const item = (key, width = 10, height = 20) => ({ key, width, height });
test('only misses are measured once in a synchronous batch', () => {
  const batches = [],
    cache = createMeasurementCache((keys) => {
      batches.push([...keys]);
      return keys.map((key) => item(key));
    });
  assert.deepEqual(cache.read(['a', 'b', 'a']), [item('a'), item('b')]);
  assert.deepEqual(cache.read(['b', 'c']), [item('b'), item('c')]);
  assert.deepEqual(batches, [['a', 'b'], ['c']]);
  cache.read(['c']);
  cache.read([]);
  assert.equal(batches.length, 2);
});
test('LRU eviction follows request order while peek and snapshots do not touch', () => {
  const cache = createMeasurementCache((keys) => keys.map((key) => item(key)), { maxEntries: 2 });
  cache.read(['a', 'b']);
  cache.peek('a');
  cache.snapshot();
  cache.set('c', item('unused'));
  assert.equal(cache.peek('a'), null);
  cache.read(['b']);
  cache.set('d', item('unused'));
  assert.equal(cache.peek('c'), null);
  assert.deepEqual(
    cache.snapshot().map((entry) => entry.key),
    ['b', 'd'],
  );
});
test('requests larger than the cache return every measurement but retain only newest entries', () => {
  const cache = createMeasurementCache((keys) => keys.map((key) => item(key)), { maxEntries: 1 });
  assert.equal(cache.read(['a', 'b', 'c']).length, 3);
  assert.deepEqual(cache.snapshot(), [item('c')]);
  assert.equal(cache.size, 1);
});
test('adapter output order does not change request output or LRU ordering', () => {
  const cache = createMeasurementCache((keys) => [...keys].reverse().map((key) => item(key)));
  assert.deepEqual(cache.read(['a', 'b']), [item('a'), item('b')]);
});
test('adapter errors do not partially cache results or touch hit recency', () => {
  let fail = false;
  const cache = createMeasurementCache(function* (keys) {
    for (const key of keys) {
      yield item(key);
      if (fail) throw new Error('measurement failure');
    }
  });
  cache.read(['a', 'b']);
  fail = true;
  assert.throws(() => cache.read(['a', 'c']), /measurement failure/);
  assert.deepEqual(cache.snapshot(), [item('a'), item('b')]);
  assert.equal(cache.peek('c'), null);
});
test('missing, duplicate, extra and nonfinite measurements are explicit atomic errors', () => {
  for (const output of [
    [],
    [item('x')],
    [item('a'), item('a')],
    [item('a'), item('b')],
    [item('a', NaN)],
    [item('a', -1)],
  ]) {
    const cache = createMeasurementCache(() => output);
    assert.throws(() => cache.read(['a']), TypeError);
    assert.equal(cache.size, 0);
  }
});
test('async adapters and invalid iterable outputs cannot masquerade as empty measurements', () => {
  for (const output of [undefined, null, Promise.resolve([]), 1]) {
    const cache = createMeasurementCache(() => output);
    assert.throws(() => cache.read(['a']), TypeError);
    assert.equal(cache.size, 0);
  }
});
test('set, read, peek and snapshot values do not expose mutable state', () => {
  const size = { width: 1, height: 2 },
    cache = createMeasurementCache((keys) => keys.map((key) => ({ key, ...size })));
  cache.set('a', size);
  size.width = 100;
  cache.peek('a').width = 9;
  cache.snapshot()[0].height = 8;
  cache.read(['a'])[0].width = 77;
  assert.deepEqual(cache.peek('a'), item('a', 1, 2));
});
test('invalidation deduplicates keys, returns removed count and forces remeasurement', () => {
  let width = 1;
  const cache = createMeasurementCache((keys) => keys.map((key) => item(key, width++)));
  cache.read(['a', 'b']);
  assert.equal(cache.invalidate(['a', 'a', 'unknown']), 1);
  assert.equal(cache.read(['a'])[0].width, 3);
  assert.equal(cache.invalidate(), 2);
  assert.equal(cache.invalidate(), 0);
});
test('invalid key iterators and oversized invalidations preserve all cached entries', () => {
  const cache = createMeasurementCache((keys) => keys.map((key) => item(key)), { maxBatch: 2 });
  cache.read(['a', 'b']);
  assert.throws(() => cache.invalidate(['a', '']), TypeError);
  assert.throws(() => cache.invalidate(['a', 'b', 'c']), RangeError);
  assert.throws(() => cache.read(['a', 'a', 'a']), RangeError);
  assert.equal(cache.size, 2);
});
test('reentrant adapters and key iterators cannot alter staged state', () => {
  let cache;
  cache = createMeasurementCache((keys) => {
    assert.throws(() => cache.invalidate(), /reentrant/);
    assert.throws(() => cache.read(['other']), /reentrant/);
    assert.throws(() => cache.set('x', { width: 1, height: 1 }), /reentrant/);
    return keys.map((key) => item(key));
  });
  cache.read(['a']);
  cache.invalidate(
    (function* () {
      assert.throws(() => cache.set('bad', item('bad')), /reentrant/);
      yield 'a';
    })(),
  );
  assert.equal(cache.size, 0);
});
test('set validates stable dimension snapshots and rejects reentrant size getters', () => {
  const cache = createMeasurementCache(() => []);
  let calls = 0;
  cache.set('a', {
    get width() {
      calls++;
      return 2;
    },
    height: 3,
  });
  assert.equal(calls, 1);
  assert.deepEqual(cache.peek('a'), item('a', 2, 3));
  assert.throws(
    () =>
      cache.set('b', {
        get width() {
          cache.invalidate();
          return 1;
        },
        height: 1,
      }),
    /reentrant/,
  );
  assert.equal(cache.size, 1);
});
test('capacity, dimensions and key validation reject before mutation', () => {
  assert.throws(() => createMeasurementCache(() => [], { maxEntries: 0 }), RangeError);
  assert.throws(() => createMeasurementCache(null), TypeError);
  const cache = createMeasurementCache(() => []);
  assert.throws(() => cache.peek(''), TypeError);
  for (const value of [Infinity, NaN, -1, '2'])
    assert.throws(() => cache.set('a', { width: value, height: 0 }), TypeError);
  cache.set('__proto__', { width: 0, height: 0 });
  assert.deepEqual(cache.peek('__proto__'), item('__proto__', 0, 0));
});
test('generated operations match an independent bounded recency-list oracle', () => {
  const cache = createMeasurementCache((keys) => keys.map((key) => item(key)), { maxEntries: 7 });
  let oracle = [],
    seed = 42;
  for (let i = 0; i < 1000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const key = String(seed % 20);
    if (i % 5 === 0) {
      cache.invalidate([key]);
      oracle = oracle.filter((id) => id !== key);
    } else {
      cache.read([key]);
      oracle = [...oracle.filter((id) => id !== key), key].slice(-7);
    }
    assert.deepEqual(
      cache.snapshot().map((entry) => entry.key),
      oracle,
    );
  }
});
test('CommonJS creates independent caches without browser APIs', () => {
  const api = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.deepEqual(api.createMeasurementCache((keys) => keys.map((key) => item(key))).read(['a']), [
    item('a'),
  ]);
});

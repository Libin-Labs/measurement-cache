export interface Size {
  width: number;
  height: number;
}
export interface Measurement extends Size {
  key: string;
}
export type MeasureBatch = (keys: readonly string[]) => Iterable<Measurement>;
export interface CacheOptions {
  maxEntries?: number;
  maxBatch?: number;
}
export interface MeasurementCache {
  readonly size: number;
  read(keys: Iterable<string>): Measurement[];
  peek(key: string): Measurement | null;
  set(key: string, size: Size): void;
  invalidate(keys?: Iterable<string>): number;
  snapshot(): Measurement[];
}
function label(value: string): void {
  if (typeof value !== 'string' || !value || value.length > 1024)
    throw new TypeError('Measurement keys must be nonempty strings up to 1024 units.');
}
function positive(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError('Capacities must be positive safe integers.');
  return value;
}
function measurement(key: string, size: Size): Measurement {
  if (!size) throw new TypeError('Expected a size.');
  const { width, height } = size;
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0)
    throw new TypeError('Measurements require non-negative finite width and height.');
  return { key, width, height };
}
export function createMeasurementCache(
  measure: MeasureBatch,
  options: CacheOptions = {},
): MeasurementCache {
  if (typeof measure !== 'function') throw new TypeError('Expected a synchronous batch adapter.');
  const maximum = positive(options.maxEntries ?? 10_000);
  const maxBatch = positive(options.maxBatch ?? 10_000);
  let cache = new Map<string, Measurement>(),
    reading = false;
  const guard = () => {
    if (reading) throw new TypeError('Cache operations cannot be reentrant during read.');
  };
  const keys = (input: Iterable<string>) => {
    if (input == null || typeof input[Symbol.iterator] !== 'function')
      throw new TypeError('Expected iterable measurement keys.');
    const result = new Set<string>();
    let count = 0;
    for (const key of input) {
      if (++count > maxBatch) throw new RangeError('Batch capacity exceeded.');
      label(key);
      result.add(key);
    }
    return [...result];
  };
  const put = (target: Map<string, Measurement>, value: Measurement) => {
    target.delete(value.key);
    target.set(value.key, value);
    if (target.size > maximum) target.delete(target.keys().next().value!);
  };
  return {
    get size() {
      guard();
      return cache.size;
    },
    read(input) {
      guard();
      reading = true;
      try {
        const requested = keys(input),
          missing = requested.filter((key) => !cache.has(key));
        const measured = new Map<string, Measurement>();
        if (missing.length) {
          const wanted = new Set(missing);
          const output = measure(Object.freeze([...missing]));
          if (output == null || typeof output[Symbol.iterator] !== 'function')
            throw new TypeError('Batch adapter must return iterable measurements synchronously.');
          for (const value of output) {
            if (measured.size === missing.length)
              throw new TypeError('Adapter returned too many measurements.');
            if (!value || !wanted.has(value.key) || measured.has(value.key))
              throw new TypeError('Adapter returned unknown or duplicate keys.');
            measured.set(value.key, measurement(value.key, value));
          }
          if (measured.size !== missing.length)
            throw new TypeError('Adapter must return every missing key exactly once.');
        }
        const next = new Map(cache);
        const result = requested.map((key) => {
          const value = cache.get(key) ?? measured.get(key)!;
          put(next, value);
          return { ...value };
        });
        cache = next;
        return result;
      } finally {
        reading = false;
      }
    },
    peek(key) {
      guard();
      label(key);
      const value = cache.get(key);
      return value ? { ...value } : null;
    },
    set(key, size) {
      guard();
      label(key);
      reading = true;
      try {
        put(cache, measurement(key, size));
      } finally {
        reading = false;
      }
    },
    invalidate(input) {
      guard();
      reading = true;
      try {
        if (input === undefined) {
          const count = cache.size;
          cache.clear();
          return count;
        }
        const requested = keys(input);
        let count = 0;
        for (const key of requested) if (cache.delete(key)) count++;
        return count;
      } finally {
        reading = false;
      }
    },
    snapshot() {
      guard();
      return [...cache.values()].map((value) => ({ ...value }));
    },
  };
}

/**
 * A least-recently-used cache holding at most `capacity` entries (#368: details are cached by
 * oid in an LRU of 200). A Map keeps insertion order, so the first key is the least recent; a
 * read or a write moves its key to the end.
 */
export class Lru<K, V> {
  readonly capacity: number;
  private readonly entries = new Map<K, V>();

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

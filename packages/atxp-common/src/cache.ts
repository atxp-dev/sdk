/**
 * Cache interface for abstracting cache mechanisms
 * This allows for easy mocking in tests and potential future
 * support for different cache backends (e.g., React Native AsyncStorage)
 */
export interface ICache<T = string> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  delete(key: string): void;
}

/**
 * Type-safe cache wrapper for JSON data
 */
export class JsonCache<T> {
  constructor(private cache: ICache<string>) {}

  get(key: string): T | null {
    const data = this.cache.get(key);
    if (!data) return null;

    try {
      const parsed = JSON.parse(data);
      return parsed as T;
    } catch {
      return null;
    }
  }

  set(key: string, data: T): void {
    this.cache.set(key, JSON.stringify(data));
  }

  delete(key: string): void {
    this.cache.delete(key);
  }
}

/**
 * Browser localStorage implementation
 */
export class BrowserCache implements ICache<string> {
  private isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  get(key: string): string | null {
    if (!this.isAvailable()) return null;
    return localStorage.getItem(key);
  }

  set(key: string, value: string): void {
    if (!this.isAvailable()) return;
    localStorage.setItem(key, value);
  }

  delete(key: string): void {
    if (!this.isAvailable()) return;
    localStorage.removeItem(key);
  }
}

/**
 * In-memory cache implementation for testing
 */
export class MemoryCache implements ICache<string> {
  private store: Map<string, string> = new Map();

  get(key: string): string | null {
    return this.store.get(key) || null;
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}


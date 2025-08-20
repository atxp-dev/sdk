import { SpendPermission } from './types.js';

/**
 * Stored permission data structure
 */
export interface StoredPermissionData {
  /** Ephemeral wallet private key */
  privateKey: `0x${string}`;
  /** Spend permission from Base */
  permission: SpendPermission;
}

/**
 * Storage interface for abstracting storage mechanisms
 * This allows for easy mocking in tests and potential future
 * support for different storage backends (e.g., React Native AsyncStorage)
 */
export interface IStorage<T = string> {
  getItem(key: string): T | null;
  setItem(key: string, value: T): void;
  removeItem(key: string): void;
}

/**
 * Type-safe storage wrapper for permission data
 */
export class PermissionStorage {
  constructor(private storage: IStorage<string>) {}

  getPermission(key: string): StoredPermissionData | null {
    const data = this.storage.getItem(key);
    if (!data) return null;
    
    try {
      const parsed = JSON.parse(data);
      // Validate the structure
      if (this.isValidStoredPermission(parsed)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  setPermission(key: string, data: StoredPermissionData): void {
    this.storage.setItem(key, JSON.stringify(data));
  }

  removePermission(key: string): void {
    this.storage.removeItem(key);
  }

  private isValidStoredPermission(data: unknown): data is StoredPermissionData {
    if (!data || typeof data !== 'object' || data === null) {
      return false;
    }
    
    const obj = data as Record<string, unknown>;
    return Boolean(
      typeof obj.privateKey === 'string' &&
      obj.privateKey.startsWith('0x') &&
      obj.permission &&
      typeof obj.permission === 'object' &&
      obj.permission !== null &&
      'permission' in obj.permission &&
      typeof (obj.permission as Record<string, unknown>).permission === 'object'
    );
  }
}

/**
 * Browser localStorage implementation
 */
export class BrowserStorage implements IStorage<string> {
  getItem(key: string): string | null {
    return localStorage.getItem(key);
  }

  setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  removeItem(key: string): void {
    localStorage.removeItem(key);
  }
}

/**
 * In-memory storage implementation for testing
 */
export class MemoryStorage implements IStorage<string> {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

import { SpendPermission } from './types.js';
import { Hex } from '@atxp/client';

/**
 * Stored permission data structure
 */
export interface Intermediary {
  /** Ephemeral wallet private key */
  privateKey: Hex;
  /** Spend permission from World Chain */
  permission: SpendPermission;
}

/**
 * Storage interface for abstracting storage mechanisms
 * This allows for easy mocking in tests and potential future
 * support for different storage backends (e.g., React Native AsyncStorage)
 */
export interface IStorage<T = string> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  delete(key: string): void;
}

/**
 * Type-safe storage wrapper for permission data
 */
export class IntermediaryStorage {
  constructor(private storage: IStorage<string>) {}

  get(key: string): Intermediary | null {
    const data = this.storage.get(key);
    if (!data) return null;

    try {
      const parsed = JSON.parse(data);
      return parsed as Intermediary;
    } catch {
      return null;
    }
  }

  set(key: string, data: Intermediary): void {
    this.storage.set(key, JSON.stringify(data));
  }

  delete(key: string): void {
    this.storage.delete(key);
  }
}

/**
 * Browser localStorage implementation
 */
export class BrowserStorage implements IStorage<string> {
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
 * In-memory storage implementation for testing
 */
export class MemoryStorage implements IStorage<string> {
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
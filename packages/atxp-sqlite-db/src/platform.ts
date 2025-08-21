/* eslint-disable @typescript-eslint/no-explicit-any */

// Platform abstraction layer
export interface PlatformSQLite {
  openDatabase: (name: string) => SQLiteDatabase;
}

export interface SQLiteDatabase {
  execAsync: (sql: string) => Promise<void>;
  prepareAsync: (sql: string) => Promise<SQLiteStatement>;
  closeAsync: () => Promise<void>;
}

export interface SQLiteStatement {
  executeAsync: <T = any>(...params: any[]) => Promise<SQLiteResult<T>>;
  finalizeAsync: () => Promise<void>;
}

export interface SQLiteResult<T> {
  getFirstAsync: () => Promise<T | null>;
}

// Helper to load modules in both CommonJS and ESM environments
function loadModule(moduleId: string): any {
  try {
    // Try to use eval('require') to prevent bundler static analysis
    const requireFunc = (0, eval)('require');
    return requireFunc(moduleId);
  } catch {
    throw new Error(`Failed to load module "${moduleId}" synchronously. In ESM environments, please ensure the module is pre-loaded or use MemoryOAuthDb instead.`);
  }
}

function createNodeSQLite(): PlatformSQLite {
  return {
    openDatabase: (name: string) => {
      let db: any = null;
      let dbPromise: Promise<any> | null = null;
      
      const getDbAsync = async () => {
        if (db) return db;
        
        if (!dbPromise) {
          dbPromise = (async () => {
            try {
              // Try synchronous loading first (works in CJS)
              const Database = loadModule('better-sqlite3');
              db = new Database(name);
            } catch {
              // Fall back to async loading for ESM
              const module = await import('better-sqlite3');
              const Database = (module as any).default || module;
              db = new Database(name);
            }
            return db;
          })();
        }
        
        return dbPromise;
      };
      
      return {
        execAsync: async (sql: string) => {
          const database = await getDbAsync();
          database.exec(sql);
        },
        prepareAsync: async (sql: string) => {
          const database = await getDbAsync();
          const stmt = database.prepare(sql);
          return {
            executeAsync: async <T>(...params: any[]) => {
              // Use .all() for SELECT, .run() for others
              const isSelect = /^\s*select/i.test(sql);
              let resultRows: T[] = [];
              if (isSelect) {
                resultRows = stmt.all(...params);
              } else {
                stmt.run(...params);
              }
              return {
                getFirstAsync: async () => {
                  if (isSelect) {
                    return resultRows[0] || null;
                  } else {
                    return null;
                  }
                },
                // Optionally, you could expose runResult for non-SELECTs if needed
              };
            },
            finalizeAsync: async () => {
              // better-sqlite3 statements are automatically finalized when they go out of scope
            },
          };
        },
        closeAsync: async () => {
          if (db) {
            db.close();
            db = null;
          }
        },
      };
    },
  };
}

// Export SQLite implementation
export const sqlite: PlatformSQLite = createNodeSQLite();
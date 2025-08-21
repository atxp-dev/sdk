import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('SQLite Platform Bundler Compatibility', () => {
  it('should use eval trick for better-sqlite3 to prevent bundler analysis', () => {
    // Skip this test if the file does not exist
    const compiledPath = join(__dirname, '../dist/platform.js');
    if (!existsSync(compiledPath)) {
      console.log('Skipping test because dist/platform.js does not exist');
      return;
    }

    // Read the compiled platform.js file
    const compiledCode = readFileSync(compiledPath, 'utf-8');
    
    // Should NOT contain direct require of better-sqlite3
    expect(compiledCode).not.toContain("require('better-sqlite3')");
    expect(compiledCode).not.toContain('require("better-sqlite3")');
    
    // Should contain eval trick to avoid bundler static analysis
    expect(compiledCode).toContain("eval('require')");
  });

  it('should handle module loading gracefully in different environments', () => {
    // Skip this test if the file does not exist
    const compiledPath = join(__dirname, '../dist/platform.js');
    if (!existsSync(compiledPath)) {
      console.log('Skipping test because dist/platform.js does not exist');
      return;
    }

    const compiledCode = readFileSync(compiledPath, 'utf-8');
    
    // Should have proper error handling for failed module loads
    expect(compiledCode).toContain('Failed to load module');
    expect(compiledCode).toContain('MemoryOAuthDb instead');
  });
});
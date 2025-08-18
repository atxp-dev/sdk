import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Bundler Compatibility', () => {
  it('should use eval trick for better-sqlite3 to prevent bundler analysis', () => {
    // Skip this test if the file does not exist
    if (!existsSync(join(__dirname, '../../../dist/src/platform/index.js'))) {
      console.log('Skipping test because dist/src/platform/index.js does not exist');
      return;
    }

    // Read the compiled platform/index.js file
    const compiledPath = join(__dirname, '../../../dist/src/client/platform/index.js');
    const compiledCode = readFileSync(compiledPath, 'utf-8');
    
    // Should NOT contain direct require of better-sqlite3
    expect(compiledCode).not.toContain("require('better-sqlite3')");
    expect(compiledCode).not.toContain('require("better-sqlite3")');
    
    // Should contain eval trick
    expect(compiledCode).toContain("eval('require')('better-sqlite3')");
  });

  it('should not have direct Node.js module imports in platform code', () => {
    // Skip this test if the file does not exist
    if (!existsSync(join(__dirname, '../../../dist/src/client/platform/index.js'))) {
      console.log('Skipping test because dist/src/client/platform/index.js does not exist');
      return;
    }

    const compiledPath = join(__dirname, '../../../dist/src/client/platform/index.js');
    const compiledCode = readFileSync(compiledPath, 'utf-8');
    
    // Should not have direct requires of Node.js built-ins that would fail in React Native
    const nodeBuiltins = ['fs', 'path', 'url', 'http', 'https', 'stream', 'buffer', 'util'];
    for (const builtin of nodeBuiltins) {
      expect(compiledCode).not.toMatch(new RegExp(`require\\(['"]${builtin}['"]\\)`));
    }
  });
}); 

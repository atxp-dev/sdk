/**
 * Integration tests for package manager compatibility
 * Tests crypto functionality when packages are consumed by external projects
 * using different package managers (npm, pnpm, yarn, bun)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Test configuration
const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn'] as const;
const TEST_TIMEOUT = 120_000; // 2 minutes per test
const TEST_DATA_HASH = '916f0027a575074ce72a331777c3478d6513f786a591bd892da1a577bf2335f9';
const TEST_HEX_OUTPUT = 'ff8040';

// Test script that will be run in external projects
// Generate the consumer test script dynamically
const createConsumerTestScript = () => `#!/usr/bin/env node

async function testCrypto() {
  try {
    const { crypto, isNode, isBrowser, getIsReactNative } = await import('@atxp/common/dist/platform/index.js');
    
    // Test environment detection
    if (!isNode) throw new Error('Environment detection failed: expected isNode=true');
    if (isBrowser) throw new Error('Environment detection failed: expected isBrowser=false');
    if (getIsReactNative()) throw new Error('Environment detection failed: expected isReactNative=false');
    
    // Test randomUUID
    const uuid = crypto.randomUUID();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(uuid)) throw new Error('Invalid UUID format: ' + uuid);
    
    // Test digest with known input
    const testData = new TextEncoder().encode('test data');
    const hash = await crypto.digest(testData);
    const hex = crypto.toHex(hash);
    if (hex !== '${TEST_DATA_HASH}') throw new Error('Hash mismatch. Expected: ${TEST_DATA_HASH}, Got: ' + hex);
    
    // Test toHex with known input
    const testArray = new Uint8Array([255, 128, 64]);
    const testHex = crypto.toHex(testArray);
    if (testHex !== '${TEST_HEX_OUTPUT}') throw new Error('Hex mismatch. Expected: ${TEST_HEX_OUTPUT}, Got: ' + testHex);
    
    // Test consistency
    const hash1 = await crypto.digest(testData);
    const hash2 = await crypto.digest(testData);
    if (crypto.toHex(hash1) !== crypto.toHex(hash2)) throw new Error('Digest consistency test failed');
    
    console.log('SUCCESS: All crypto tests passed');
    return true;
  } catch (error) {
    console.error('FAILED:', error.message);
    process.exit(1);
  }
}

testCrypto().catch(e => { console.error('CRASHED:', e.message); process.exit(1); });
`.replace(/\$\{TEST_DATA_HASH\}/g, TEST_DATA_HASH).replace(/\$\{TEST_HEX_OUTPUT\}/g, TEST_HEX_OUTPUT);

describe('Package Manager Integration Tests', () => {
  let testDir: string;
  let packageTarball: string;

  beforeAll(async () => {
    // Create temporary test directory
    testDir = mkdtempSync(join(tmpdir(), 'atxp-integration-'));
    
    // Build and pack the current package
    console.log('Building and packing @atxp/common for integration tests...');
    execSync('npm run build', { cwd: process.cwd() });
    const packOutput = execSync('npm pack', { cwd: process.cwd(), encoding: 'utf8' });
    packageTarball = join(process.cwd(), packOutput.trim());
    
    console.log(`Created package: ${packageTarball}`);
    console.log(`Test directory: ${testDir}`);
  }, 60_000); // 60 second timeout for build and pack operations

  afterAll(() => {
    // Clean up test directory and tarball
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch (e) {
        console.warn('Failed to clean up test directory:', e);
      }
    }
    if (packageTarball) {
      try {
        rmSync(packageTarball, { force: true });
      } catch (e) {
        console.warn('Failed to clean up package tarball:', e);
      }
    }
  });

  for (const packageManager of PACKAGE_MANAGERS) {
    it(`should work when installed with ${packageManager}`, async () => {
      // Skip if package manager is not available
      try {
        execSync(`which ${packageManager}`, { stdio: 'ignore' });
      } catch {
        console.warn(`Skipping ${packageManager} test - not installed`);
        return;
      }

      const projectDir = join(testDir, `test-${packageManager}`);
      
      try {
        // Create test project directory
        mkdirSync(projectDir, { recursive: true });
        
        // Create package.json
        const packageJson = {
          name: `atxp-${packageManager}-test`,
          version: '1.0.0',
          type: 'module',
          scripts: { test: 'node test.js' }
        };
        writeFileSync(join(projectDir, 'package.json'), JSON.stringify(packageJson, null, 2));
        
        // Create test script
        writeFileSync(join(projectDir, 'test.js'), createConsumerTestScript());
        
        // Install package with specific package manager
        const installCmd = packageManager === 'npm' 
          ? `npm install "${packageTarball}"`
          : packageManager === 'yarn'
          ? `yarn add "${packageTarball}"` 
          : `pnpm add "${packageTarball}"`;
          
        console.log(`Installing with ${packageManager}...`);
        execSync(installCmd, { cwd: projectDir, stdio: 'inherit' });
        
        // Run the test
        console.log(`Running crypto test with ${packageManager}...`);
        const testOutput = execSync('node test.js', { 
          cwd: projectDir, 
          encoding: 'utf8',
          timeout: 30_000 
        });
        
        // Verify success message
        expect(testOutput).toContain('SUCCESS: All crypto tests passed');
        
      } catch (error) {
        console.error(`${packageManager} integration test failed:`, error);
        throw error;
      }
    }, TEST_TIMEOUT);
  }

  // Special test for bun if available
  it('should work when installed with bun', async () => {
    // Check if bun is available
    try {
      execSync('which bun', { stdio: 'ignore' });
    } catch {
      console.warn('Skipping bun test - not installed');
      return;
    }

    const projectDir = join(testDir, 'test-bun');
    
    try {
      mkdirSync(projectDir, { recursive: true });
      
      const packageJson = {
        name: 'atxp-bun-test',
        version: '1.0.0',
        type: 'module',
        scripts: { test: 'bun run test.js' }
      };
      writeFileSync(join(projectDir, 'package.json'), JSON.stringify(packageJson, null, 2));
      writeFileSync(join(projectDir, 'test.js'), createConsumerTestScript());
      
      console.log('Installing with bun...');
      execSync(`bun add "${packageTarball}"`, { cwd: projectDir, stdio: 'inherit' });
      
      console.log('Running crypto test with bun...');
      const testOutput = execSync('bun run test.js', { 
        cwd: projectDir, 
        encoding: 'utf8',
        timeout: 30_000 
      });
      
      expect(testOutput).toContain('SUCCESS: All crypto tests passed');
      
    } catch (error) {
      console.error('Bun integration test failed:', error);
      throw error;
    }
  }, TEST_TIMEOUT);
});
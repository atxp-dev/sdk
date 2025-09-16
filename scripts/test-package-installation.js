#!/usr/bin/env node

/**
 * Package Installation Test Script
 *
 * This script tests that all ATXP packages can be:
 * 1. Built and packed successfully
 * 2. Installed from the packed tarball
 * 3. Imported and used correctly
 *
 * Usage: node scripts/test-package-installation.js [package-name]
 *   - Without package-name: tests all packages
 *   - With package-name: tests specific package (e.g., "atxp-client")
 */

import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');
const tempDir = path.join(rootDir, '.tmp-package-test');

// ATXP packages to test
const PACKAGES = [
  'atxp-common',
  'atxp-client',
  'atxp-server',
  'atxp-base',
  'atxp-redis',
  'atxp-sqlite',
  'atxp-express-middleware'
];

/**
 * Execute command and return output
 */
function exec(command, options = {}) {
  console.log(`  Running: ${command}`);
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      ...options
    });
    return output.trim();
  } catch (error) {
    console.error(`  ❌ Command failed: ${command}`);
    console.error(`  Error: ${error.message}`);
    if (error.stdout) console.error(`  Stdout: ${error.stdout}`);
    if (error.stderr) console.error(`  Stderr: ${error.stderr}`);
    throw error;
  }
}

/**
 * Clean up temporary directory
 */
async function cleanup() {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Test a single package
 */
async function testPackage(packageName) {
  console.log(`\n🧪 Testing package: @atxp/${packageName}`);

  const packageDir = path.join(packagesDir, packageName);
  const packageJsonPath = path.join(packageDir, 'package.json');

  // Verify package directory exists
  try {
    await fs.access(packageDir);
    await fs.access(packageJsonPath);
  } catch (error) {
    throw new Error(`Package directory or package.json not found: ${packageDir}`);
  }

  // Read package.json to get the actual package name
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const fullPackageName = packageJson.name;

  // Step 1: Run pack dry-run to validate package contents
  console.log(`  📦 Running pack dry-run for ${fullPackageName}...`);
  try {
    exec('npm run pack:dry', { cwd: packageDir });
    console.log(`  ✅ Pack dry-run successful`);
  } catch (error) {
    console.error(`  ❌ Pack dry-run failed for ${fullPackageName}`);
    throw error;
  }

  // Step 2: Build and pack the package
  console.log(`  🔨 Building and packing ${fullPackageName}...`);
  let tarballPath;
  try {
    // This will trigger prepack (build + typecheck) then create tarball
    const packOutput = exec('npm pack', { cwd: packageDir });

    // Extract tarball filename from output
    const tarballName = packOutput.split('\n').find(line => line.endsWith('.tgz'));
    if (!tarballName) {
      throw new Error('Could not find tarball name in npm pack output');
    }

    tarballPath = path.join(packageDir, tarballName);
    console.log(`  ✅ Package created: ${tarballName}`);
  } catch (error) {
    console.error(`  ❌ Failed to pack ${fullPackageName}`);
    throw error;
  }

  // Step 3: Create temporary directory and install the package
  console.log(`  📥 Testing installation of ${fullPackageName}...`);
  const testDir = path.join(tempDir, packageName);

  try {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });

    // Create a basic package.json for the test
    const testPackageJson = {
      name: `test-${packageName}`,
      version: '1.0.0',
      type: 'module',
      private: true
    };
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify(testPackageJson, null, 2)
    );

    // Install the packed tarball
    exec(`npm install ${tarballPath}`, { cwd: testDir });
    console.log(`  ✅ Package installed successfully`);

    // Verify package can be imported (basic smoke test)
    const testScript = `
      try {
        const pkg = await import('${fullPackageName}');
        console.log('✅ Package imported successfully');
        console.log('Exports:', Object.keys(pkg));
      } catch (error) {
        console.error('❌ Failed to import package:', error.message);
        process.exit(1);
      }
    `;

    await fs.writeFile(path.join(testDir, 'test-import.mjs'), testScript);
    exec('node test-import.mjs', { cwd: testDir });
    console.log(`  ✅ Package import test passed`);

  } catch (error) {
    console.error(`  ❌ Installation test failed for ${fullPackageName}`);
    throw error;
  } finally {
    // Clean up tarball
    try {
      await fs.unlink(tarballPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  console.log(`  🎉 All tests passed for ${fullPackageName}\n`);
}

/**
 * Main test function
 */
async function main() {
  const targetPackage = process.argv[2];

  console.log('🚀 ATXP Package Installation Test');
  console.log('=====================================');

  if (targetPackage) {
    if (!PACKAGES.includes(targetPackage)) {
      console.error(`❌ Unknown package: ${targetPackage}`);
      console.error(`Available packages: ${PACKAGES.join(', ')}`);
      process.exit(1);
    }
    console.log(`Testing single package: ${targetPackage}`);
  } else {
    console.log(`Testing all packages: ${PACKAGES.join(', ')}`);
  }

  // Clean up any previous test artifacts
  await cleanup();

  const packagesToTest = targetPackage ? [targetPackage] : PACKAGES;
  const results = [];

  for (const packageName of packagesToTest) {
    try {
      await testPackage(packageName);
      results.push({ package: packageName, status: 'PASSED' });
    } catch (error) {
      console.error(`❌ Test failed for ${packageName}:`, error.message);
      results.push({ package: packageName, status: 'FAILED', error: error.message });
    }
  }

  // Cleanup
  await cleanup();

  // Print summary
  console.log('\n📊 Test Summary');
  console.log('================');
  let allPassed = true;

  for (const result of results) {
    const status = result.status === 'PASSED' ? '✅' : '❌';
    console.log(`${status} @atxp/${result.package}: ${result.status}`);
    if (result.error) {
      console.log(`    Error: ${result.error}`);
    }
    if (result.status === 'FAILED') {
      allPassed = false;
    }
  }

  console.log(`\n${allPassed ? '🎉' : '💥'} Overall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);

  if (!allPassed) {
    process.exit(1);
  }
}

// Handle cleanup on process termination
process.on('SIGINT', async () => {
  console.log('\n🧹 Cleaning up...');
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

// Run the tests
main().catch((error) => {
  console.error('❌ Test runner failed:', error);
  cleanup().finally(() => process.exit(1));
});
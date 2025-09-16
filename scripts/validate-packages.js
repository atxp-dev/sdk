#!/usr/bin/env node

/**
 * Package Validation Script
 *
 * This script validates all ATXP packages for:
 * 1. Package.json correctness
 * 2. Build artifacts existence
 * 3. TypeScript declarations
 * 4. Export map validation
 * 5. File inclusion correctness
 *
 * Usage: node scripts/validate-packages.js [package-name]
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');

// ATXP packages to validate
const PACKAGES = [
  'atxp-common',
  'atxp-client',
  'atxp-server',
  'atxp-base',
  'atxp-redis',
  'atxp-sqlite',
  'atxp-express-middleware'
];

// Required fields in package.json
const REQUIRED_FIELDS = [
  'name',
  'version',
  'description',
  'license',
  'type',
  'main',
  'module',
  'types',
  'exports',
  'files',
  'scripts'
];

// Required scripts
const REQUIRED_SCRIPTS = [
  'build',
  'typecheck',
  'lint',
  'test',
  'prepack',
  'pack:dry'
];

// Required build artifacts
const REQUIRED_ARTIFACTS = [
  'dist/index.js',    // ESM entry
  'dist/index.cjs',   // CommonJS entry
  'dist/index.d.ts'   // TypeScript declarations
];

/**
 * Check if file exists
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a single package
 */
async function validatePackage(packageName) {
  console.log(`\n🔍 Validating package: @atxp/${packageName}`);

  const packageDir = path.join(packagesDir, packageName);
  const packageJsonPath = path.join(packageDir, 'package.json');

  const errors = [];
  const warnings = [];

  // Check if package directory exists
  if (!(await fileExists(packageDir))) {
    errors.push(`Package directory not found: ${packageDir}`);
    return { errors, warnings };
  }

  // Read package.json
  let packageJson;
  try {
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
    packageJson = JSON.parse(packageJsonContent);
  } catch (error) {
    errors.push(`Failed to read/parse package.json: ${error.message}`);
    return { errors, warnings };
  }

  // Validate required fields
  console.log('  📋 Checking required fields...');
  for (const field of REQUIRED_FIELDS) {
    if (!packageJson[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate scripts
  console.log('  📜 Checking required scripts...');
  for (const script of REQUIRED_SCRIPTS) {
    if (!packageJson.scripts?.[script]) {
      errors.push(`Missing required script: ${script}`);
    }
  }

  // Validate package name format
  console.log('  📛 Checking package name format...');
  if (packageJson.name && !packageJson.name.startsWith('@atxp/')) {
    errors.push(`Package name should start with @atxp/: ${packageJson.name}`);
  }

  // Validate type field
  console.log('  📦 Checking module type...');
  if (packageJson.type !== 'module') {
    warnings.push(`Package type should be "module", got: ${packageJson.type}`);
  }

  // Validate sideEffects field
  if (packageJson.sideEffects !== false) {
    warnings.push('Package should have sideEffects: false for better tree-shaking');
  }

  // Check build artifacts exist
  console.log('  🔨 Checking build artifacts...');
  for (const artifact of REQUIRED_ARTIFACTS) {
    const artifactPath = path.join(packageDir, artifact);
    if (!(await fileExists(artifactPath))) {
      errors.push(`Missing build artifact: ${artifact}`);
    }
  }

  // Validate exports map
  console.log('  🚪 Checking exports map...');
  if (packageJson.exports && packageJson.exports['.']) {
    const mainExport = packageJson.exports['.'];

    // Check that exports point to existing files
    for (const [condition, filePath] of Object.entries(mainExport)) {
      if (typeof filePath === 'string') {
        const fullPath = path.join(packageDir, filePath);
        if (!(await fileExists(fullPath))) {
          errors.push(`Export "${condition}" points to non-existent file: ${filePath}`);
        }
      }
    }

    // Check required export conditions
    const requiredConditions = ['types', 'import', 'require'];
    for (const condition of requiredConditions) {
      if (!mainExport[condition]) {
        warnings.push(`Missing export condition: ${condition}`);
      }
    }
  } else {
    errors.push('Missing or invalid exports map');
  }

  // Check files array
  console.log('  📁 Checking files inclusion...');
  if (!packageJson.files || !packageJson.files.includes('dist')) {
    errors.push('Files array should include "dist"');
  }

  // Validate version format
  const versionRegex = /^\d+\.\d+\.\d+(-\w+\.\d+)?$/;
  if (packageJson.version && !versionRegex.test(packageJson.version)) {
    warnings.push(`Version format may be invalid: ${packageJson.version}`);
  }

  // Check for common dependency issues
  console.log('  🔗 Checking dependencies...');

  // Check for dev dependencies that should be peer dependencies
  const devDeps = packageJson.devDependencies || {};
  const peerDeps = packageJson.peerDependencies || {};

  const heavyCryptoDeps = ['@solana/web3.js', '@solana/pay', 'viem', 'bs58'];
  for (const dep of heavyCryptoDeps) {
    if (devDeps[dep] && !peerDeps[dep]) {
      warnings.push(`${dep} in devDependencies but not in peerDependencies - consider making it a peer dependency`);
    }
  }

  // Check repository field
  if (!packageJson.repository) {
    warnings.push('Missing repository field');
  }

  return { errors, warnings };
}

/**
 * Main validation function
 */
async function main() {
  const targetPackage = process.argv[2];

  console.log('🔍 ATXP Package Validation');
  console.log('===========================');

  if (targetPackage) {
    if (!PACKAGES.includes(targetPackage)) {
      console.error(`❌ Unknown package: ${targetPackage}`);
      console.error(`Available packages: ${PACKAGES.join(', ')}`);
      process.exit(1);
    }
    console.log(`Validating single package: ${targetPackage}`);
  } else {
    console.log(`Validating all packages: ${PACKAGES.join(', ')}`);
  }

  const packagesToValidate = targetPackage ? [targetPackage] : PACKAGES;
  const results = [];

  for (const packageName of packagesToValidate) {
    try {
      const result = await validatePackage(packageName);
      results.push({
        package: packageName,
        errors: result.errors,
        warnings: result.warnings
      });

      if (result.errors.length === 0) {
        console.log(`  ✅ Package validation passed`);
      } else {
        console.log(`  ❌ Package validation failed with ${result.errors.length} errors`);
      }

      if (result.warnings.length > 0) {
        console.log(`  ⚠️  ${result.warnings.length} warnings`);
      }

    } catch (error) {
      console.error(`❌ Validation failed for ${packageName}:`, error.message);
      results.push({
        package: packageName,
        errors: [error.message],
        warnings: []
      });
    }
  }

  // Print detailed summary
  console.log('\n📊 Validation Summary');
  console.log('=======================');

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const result of results) {
    const hasErrors = result.errors.length > 0;
    const hasWarnings = result.warnings.length > 0;

    const status = hasErrors ? '❌' : '✅';
    console.log(`\n${status} @atxp/${result.package}`);

    if (hasErrors) {
      console.log('  Errors:');
      result.errors.forEach(error => console.log(`    • ${error}`));
      totalErrors += result.errors.length;
    }

    if (hasWarnings) {
      console.log('  Warnings:');
      result.warnings.forEach(warning => console.log(`    • ${warning}`));
      totalWarnings += result.warnings.length;
    }

    if (!hasErrors && !hasWarnings) {
      console.log('  All validations passed!');
    }
  }

  console.log(`\n📈 Total: ${totalErrors} errors, ${totalWarnings} warnings`);

  if (totalErrors > 0) {
    console.log('\n💥 Validation failed! Please fix the errors above.');
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log('\n⚠️  Validation passed with warnings. Consider addressing them.');
  } else {
    console.log('\n🎉 All packages validated successfully!');
  }
}

// Run validation
main().catch((error) => {
  console.error('❌ Validation runner failed:', error);
  process.exit(1);
});
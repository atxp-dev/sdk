#!/usr/bin/env node

const { readFileSync, writeFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const { gzipSync } = require('zlib');
const { execSync } = require('child_process');

const packages = [
  'atxp-common',
  'atxp-server', 
  'atxp-client',
  'atxp-redis',
  'atxp-sqlite',
  'atxp-base'
];

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function analyzePackage(packageName) {
  try {
    const packagePath = join('packages', packageName);
    const packageJsonPath = join(packagePath, 'package.json');
    const entryPoint = join(packagePath, 'dist', 'index.js');
    
    // Read package.json
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    
    // Create a temporary bundle using esbuild
    const tempBundle = join(packagePath, `temp-bundle-${Date.now()}.js`);
    
    try {
      // Determine platform and external dependencies based on package
      let platform = 'node';
      let external = [];
      
      if (packageName === 'atxp-client') {
        platform = 'neutral';
        // For client package, mark the heaviest external deps as external
        // but still bundle the core client logic with lighter dependencies
        external = [
          '@atxp/common', '@atxp/client', '@atxp/server',
          '@solana/web3.js', '@solana/pay', '@solana/buffer-layout',
          '@solana/spl-token', 'viem', 'bs58',
          '@modelcontextprotocol/sdk', 'bignumber.js',
          'react-native-url-polyfill', 'expo-crypto'
        ];
      } else if (packageName === 'atxp-base') {
        platform = 'neutral';
        // Mark monorepo and heavy deps as external
        external = [
          '@atxp/common', '@atxp/client', '@atxp/server',
          '@base-org/account', 'viem', 'bignumber.js'
        ];
      }
      
      const externalFlag = external.length > 0 ? `--external:${external.join(' --external:')}` : '';
      
      // Bundle with esbuild
      execSync(`npx esbuild ${entryPoint} --bundle --minify --platform=${platform} --format=esm ${externalFlag} --outfile=${tempBundle}`, {
        cwd: process.cwd(),
        stdio: 'pipe' // Suppress output
      });
      
      // Read and analyze the bundled file
      const bundledContent = readFileSync(tempBundle, 'utf8');
      const rawSize = Buffer.byteLength(bundledContent, 'utf8');
      const gzippedSize = gzipSync(bundledContent).length;
      
      // Clean up temp file
      unlinkSync(tempBundle);
      
      return {
        name: packageJson.name,
        version: packageJson.version,
        rawSize,
        gzippedSize,
        rawSizeFormatted: formatBytes(rawSize),
        gzippedSizeFormatted: formatBytes(gzippedSize)
      };
    } catch (buildError) {
      // Clean up temp file if it exists
      try {
        unlinkSync(tempBundle);
      } catch {}
      
      // If bundling fails, fall back to just measuring the dist file
      const reason = buildError.message.includes('peer dependencies') ? 
        'Has peer dependencies' : 'Bundling failed';
      
      const distContent = readFileSync(entryPoint, 'utf8');
      const rawSize = Buffer.byteLength(distContent, 'utf8');
      const gzippedSize = gzipSync(distContent).length;
      
      return {
        name: packageJson.name,
        version: packageJson.version,
        rawSize,
        gzippedSize,
        rawSizeFormatted: formatBytes(rawSize),
        gzippedSizeFormatted: formatBytes(gzippedSize),
        warning: `Unbundled (${reason})`
      };
    }
  } catch (error) {
    return {
      name: `@atxp/${packageName}`,
      error: error.message
    };
  }
}

function generateReport(packageNames) {
  const results = packageNames.map(analyzePackage);
  
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  
  console.log('\n📦 Bundle Size Analysis\n');
  console.log('Package'.padEnd(20) + 'Raw Size'.padEnd(12) + 'Gzipped'.padEnd(12) + 'Status');
  console.log('─'.repeat(72));
  
  let totalRaw = 0;
  let totalGzipped = 0;
  
  results.forEach(result => {
    if (result.error) {
      console.log(`${result.name.padEnd(20)} ERROR: ${result.error}`);
    } else {
      const status = result.warning ? '⚠️  Unbundled' : '✅ Bundled';
      console.log(
        result.name.padEnd(20) + 
        result.rawSizeFormatted.padEnd(12) + 
        result.gzippedSizeFormatted.padEnd(12) + 
        status
      );
      totalRaw += result.rawSize;
      totalGzipped += result.gzippedSize;
    }
  });
  
  console.log('─'.repeat(72));
  console.log(
    'TOTAL'.padEnd(20) + 
    formatBytes(totalRaw).padEnd(12) + 
    formatBytes(totalGzipped).padEnd(12)
  );
  
  console.log('\nℹ️  All sizes are informational only - no limits enforced');
  console.log('   Raw size: Minified bundle size (with dependencies)');
  console.log('   Gzipped: Compressed size (actual network transfer size)');
}

// Run the analysis
generateReport(packages);
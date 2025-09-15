#!/usr/bin/env node

import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';

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
    const distPath = join('packages', packageName, 'dist', 'index.js');
    const packageJsonPath = join('packages', packageName, 'package.json');
    
    // Read files
    const jsContent = readFileSync(distPath, 'utf8');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    
    // Get file stats
    const jsStats = statSync(distPath);
    const gzippedSize = gzipSync(jsContent).length;
    
    return {
      name: packageJson.name,
      version: packageJson.version,
      rawSize: jsStats.size,
      gzippedSize,
      rawSizeFormatted: formatBytes(jsStats.size),
      gzippedSizeFormatted: formatBytes(gzippedSize)
    };
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
  console.log('─'.repeat(60));
  
  let totalRaw = 0;
  let totalGzipped = 0;
  
  results.forEach(result => {
    if (result.error) {
      console.log(`${result.name.padEnd(20)} ERROR: ${result.error}`);
    } else {
      const status = '✅';
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
  
  console.log('─'.repeat(60));
  console.log(
    'TOTAL'.padEnd(20) + 
    formatBytes(totalRaw).padEnd(12) + 
    formatBytes(totalGzipped).padEnd(12)
  );
  
  console.log('\nℹ️  All sizes are informational only - no limits enforced');
  console.log('   Raw size: Uncompressed JavaScript bundle');
  console.log('   Gzipped: Compressed size (closer to network transfer size)');
}

// Run the analysis
generateReport(packages);
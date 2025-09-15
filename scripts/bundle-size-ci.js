#!/usr/bin/env node
/* eslint-disable no-undef */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Package configuration
const PACKAGES = [
  'common',
  'server', 
  'client',
  'redis',
  'sqlite',
  'base'
];

/**
 * Run rollup analyzer for a specific package and capture output
 */
async function analyzePackage(packageName) {
  return new Promise((resolvePromise) => {
    const packagePath = resolve(__dirname, `../packages/atxp-${packageName}`);


    const env = {
      ...process.env,
      ANALYZE_BUNDLE: 'true',
      ANALYZE_SUMMARY_ONLY: 'true'
    };

    const child = spawn('npm', ['run', 'build'], {
      cwd: packagePath,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        // Extract bundle analysis from the output
        const lines = stdout.split('\n');
        let analysisLines = [];
        let inAnalysisBlock = false;

        for (const line of lines) {
          // Look for the start of a rollup analysis block
          if (line.includes('Rollup File Analysis')) {
            inAnalysisBlock = true;
            analysisLines.push(line);
            continue;
          }

          // If we're in an analysis block, collect lines until we hit the end marker
          if (inAnalysisBlock) {
            analysisLines.push(line);
            // End of analysis block is marked by the dashed line after module breakdown
            if (line.startsWith('-----------------------------') && analysisLines.length > 10) {
              break;
            }
          }
        }

        // If we didn't find a proper analysis block, try the old method as fallback
        if (analysisLines.length === 0) {
          let analysisStarted = false;
          for (const line of lines) {
            if (line.includes('bundle size:') || analysisStarted) {
              analysisStarted = true;
              analysisLines.push(line);
              if (line.trim() === '' && analysisLines.length > 5) {
                break;
              }
            }
          }
        }

        resolvePromise({
          name: `@atxp/${packageName}`,
          success: true,
          analysis: analysisLines.length > 0 ? analysisLines.join('\n') : 'No bundle analysis output found',
          stdout: stdout,
          stderr: stderr
        });
      } else {
        resolvePromise({
          name: `@atxp/${packageName}`,
          success: false,
          error: `Build failed with code ${code}`,
          stdout: stdout,
          stderr: stderr
        });
      }
    });
    
    child.on('error', (error) => {
      resolvePromise({
        name: `@atxp/${packageName}`,
        success: false,
        error: error.message,
        stdout: stdout,
        stderr: stderr
      });
    });
  });
}

/**
 * Generate markdown report from analysis results
 */
function generateMarkdownReport(results) {
  let report = '## 📊 Bundle Size Analysis (Rollup Analyzer)\n\n';
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (successful.length > 0) {
    report += '### Package Analysis Results\n\n';
    
    successful.forEach(result => {
      report += `#### ${result.name}\n\n`;
      report += '```\n';
      report += result.analysis || 'No analysis output captured';
      report += '\n```\n\n';
    });
  }
  
  if (failed.length > 0) {
    report += '### Failed Packages\n\n';
    failed.forEach(result => {
      report += `- **${result.name}**: ${result.error}\n`;
    });
    report += '\n';
  }
  
  report += '### Summary\n\n';
  report += `- ✅ Successfully analyzed: ${successful.length} packages\n`;
  if (failed.length > 0) {
    report += `- ❌ Failed to analyze: ${failed.length} packages\n`;
  }
  
  report += '\n### About Bundle Analysis\n\n';
  report += 'This analysis is generated using [rollup-plugin-analyzer](https://www.npmjs.com/package/rollup-plugin-analyzer) ';
  report += 'which provides detailed bundle size information including:\n\n';
  report += '- Total bundle size and compression ratios\n';
  report += '- Module-level breakdown showing largest contributors\n';
  report += '- Percentage of bundle taken by each module\n';
  report += '- Code reduction from bundling process\n\n';
  report += '> 💡 **Tip**: Use `npm run size:detailed` locally for more comprehensive analysis including individual module sizes.\n';
  
  return report;
}

/**
 * Main execution
 */
async function main() {
  const outputFormat = process.argv.includes('--json') ? 'json' : 'markdown';
  const customOutputFile = process.argv.find(arg => arg.startsWith('--output='))?.split('=')[1];
  const showToStdout = process.argv.includes('--stdout');
  const showHelp = process.argv.includes('--help') || process.argv.includes('-h');
  
  if (showHelp) {
    console.log(`
Usage: bundle-size-ci.js [options]

Options:
  --json              Output in JSON format instead of markdown
  --output=<file>     Save output to specific file (default: timestamped file in bundle-analysis/)
  --stdout            Print output to stdout instead of saving to file
  --help, -h          Show this help message

Examples:
  npm run size:ci                                    # Save timestamped report to bundle-analysis/
  npm run size:ci -- --stdout                       # Print report to terminal
  npm run size:ci -- --output=my-analysis.md        # Save to specific file
  npm run size:ci -- --json --stdout                # Print JSON to terminal
`);
    process.exit(0);
  }
  
  console.log('🔍 Analyzing bundle sizes for all packages...\n');
  
  try {
    // Analyze all packages in parallel for speed
    const results = await Promise.all(
      PACKAGES.map(packageName => analyzePackage(packageName))
    );
    
    // Generate the output content
    let outputContent;
    if (outputFormat === 'json') {
      outputContent = JSON.stringify(results, null, 2);
    } else {
      outputContent = generateMarkdownReport(results);
    }
    
    // Handle output destination
    if (showToStdout) {
      // Output directly to stdout
      console.log('📊 Bundle Size Analysis Results:\n');
      console.log(outputContent);
    } else {
      // Save to file
      const bundleAnalysisDir = resolve(__dirname, '../bundle-analysis');
      try {
        await import('fs').then(fs => fs.mkdirSync(bundleAnalysisDir, { recursive: true }));
      } catch {
        // Directory might already exist, continue
      }
      
      // Determine output file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outputFile = customOutputFile || resolve(bundleAnalysisDir, 
        outputFormat === 'json' 
          ? `bundle-analysis-${timestamp}.json`
          : `bundle-analysis-${timestamp}.md`
      );
      
      // Write to file
      writeFileSync(outputFile, outputContent);
      
      // Show user where the file is and how to view it
      console.log(`📄 ${outputFormat.toUpperCase()} analysis saved to:`);
      console.log(`   ${outputFile}`);
      console.log(`\n🔍 View the analysis:`);
      console.log(`   cat "${outputFile}"`);
      if (outputFormat === 'markdown') {
        console.log(`   code "${outputFile}"`);
      }
    }
    
    // Always show quick summary to console (regardless of output mode)
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`\n📊 Quick Summary:`);
    console.log(`   ✅ Analyzed: ${successful.length} packages`);
    if (failed.length > 0) {
      console.log(`   ❌ Failed: ${failed.length} packages`);
      // Show which packages failed
      failed.forEach(result => {
        console.log(`     • ${result.name}: ${result.error}`);
      });
    }
    
    // Exit with error if any packages failed
    if (failed.length > 0) {
      console.error(`\n⚠️  ${failed.length} package(s) failed analysis`);
      process.exit(1);
    }
    
    console.log('✅ Bundle analysis completed successfully');
    
  } catch (error) {
    console.error('❌ Bundle analysis failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { analyzePackage, generateMarkdownReport };
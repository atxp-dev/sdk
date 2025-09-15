# Bundle Size Analysis

This document describes the bundle size analysis tooling implemented for the ATXP SDK packages.

## Overview

The ATXP SDK uses [rollup-plugin-analyzer](https://www.npmjs.com/package/rollup-plugin-analyzer) to provide detailed bundle size analysis across all packages. This tooling helps monitor bundle sizes, identify optimization opportunities, and track size changes over time.

## Features

### 📊 Detailed Analysis
- **Bundle size**: Total bundle size after rollup processing
- **Code reduction**: Percentage reduction from original source
- **Module breakdown**: Visual chart showing size contribution per module
- **Module count**: Total number of modules in the bundle

### 🔄 CI Integration
- Automated bundle analysis on pull requests
- Comparison between current and base branch
- Non-blocking analysis (informational only)
- PR comments with detailed reports

### 🛠 Developer Tools
Multiple npm scripts for different analysis needs:
- `npm run size` - Quick analysis of all packages (live output during build)
- `npm run size:summary` - Summary view with charts (live output during build)  
- `npm run size:detailed` - Detailed analysis with top 20 modules (live output during build)
- `npm run size:exports` - Include export usage analysis (live output during build)
- `npm run size:ci` - Generate comprehensive report saved to file with clear file path
- `npm run size:ci:show` - Show comprehensive report directly in terminal

## Usage

### Local Development

#### Quick Analysis
```bash
# Analyze all packages with summary
npm run size:summary
```

#### Detailed Analysis
```bash
# Get detailed breakdown of largest modules
npm run size:detailed
```

#### Export Analysis
```bash
# See which exports are used/unused
npm run size:exports
```

#### CI-Style Analysis
```bash
# Generate markdown report saved to bundle-analysis/ directory
npm run size:ci

# Show analysis report directly in terminal (no file saved)
npm run size:ci:show

# Save to specific file
npm run size:ci -- --output=my-analysis.md

# Get help with all options
npm run size:ci -- --help
```

**Output Options:**
- **Default**: Saves timestamped file to `bundle-analysis/` and shows file path
- **`--stdout`**: Prints analysis directly to terminal for immediate viewing  
- **`--output=file`**: Saves to specific file location
- **`--json`**: Output in JSON format instead of markdown

All analysis outputs are saved to the `bundle-analysis/` directory and are automatically ignored by git.

### Single Package Analysis

To analyze a specific package:

```bash
cd packages/atxp-client
ANALYZE_BUNDLE=true npm run build
```

### Environment Variables

The analyzer behavior can be customized with environment variables:

- `ANALYZE_BUNDLE=true` - Enable bundle analysis
- `ANALYZE_SUMMARY_ONLY=false` - Show detailed module breakdown
- `ANALYZE_LIMIT=20` - Number of modules to show in detailed view
- `ANALYZE_SHOW_EXPORTS=true` - Include export usage information

## CI Integration

### GitHub Actions Workflow

The `bundle-size.yml` workflow runs automatically on pull requests when:
- Package source code changes (`packages/*/src/**`)
- Build configuration changes (`rollup.config.js`, `package.json`)
- Bundle analysis configuration changes

### Workflow Steps

1. **Install dependencies** and build packages
2. **Analyze current branch** using rollup-plugin-analyzer
3. **Switch to base branch** and analyze for comparison
4. **Generate comparison report** showing changes
5. **Post/update PR comment** with analysis results
6. **Upload artifacts** for manual inspection

### Output Directory Structure

Bundle analysis files are organized in the `bundle-analysis/` directory:

```
bundle-analysis/
├── bundle-analysis-2025-01-15T10-30-45.md  # Timestamped reports
├── bundle-analysis-2025-01-15T11-15-20.json # JSON format outputs
├── current-analysis.md                      # CI: Current branch analysis
├── base-analysis.md                        # CI: Base branch analysis
└── bundle-report.md                        # CI: Final comparison report
```

**Note**: All files in `bundle-analysis/` are automatically ignored by git to prevent committing generated analysis files.

### PR Comments

The workflow automatically posts/updates PR comments with:
- Current bundle size analysis for all packages
- Visual charts showing module size contributions
- Comparison with base branch (when available)
- Tips for bundle size optimization

## Understanding the Output

### Analysis Chart Example
```
-----------------------------
Rollup File Analysis
-----------------------------
bundle size:    38.282 KB
original size:  40.592 KB
code reduction: 5.69 %
module count:   12

/src/oAuthResource.ts
█████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 35.18 % (13.466 KB)
/src/platform/index.ts  
██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 20.79 % (7.958 KB)
/src/mcpJson.ts
██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 12.78 % (4.893 KB)
```

### Key Metrics

- **Bundle Size**: Final size after bundling and tree-shaking
- **Original Size**: Sum of all source file sizes
- **Code Reduction**: Percentage saved through bundling optimizations
- **Module Count**: Number of distinct modules in the bundle
- **Module Chart**: Visual representation of each module's contribution

### Optimization Insights

The analysis helps identify:
1. **Largest modules** that could benefit from code splitting
2. **Unused code** that could be tree-shaken
3. **Duplicate dependencies** across packages
4. **Bundle growth** over time through PR comparisons

## Bundle Size Thresholds

### Current Package Sizes (approx.)

| Package | Bundle Size | Status | Notes |
|---------|-------------|---------|-------|
| @atxp/common | ~39KB | ✅ Good | Core utilities and types |
| @atxp/redis | ~6KB | ✅ Good | Redis OAuth implementation |
| @atxp/sqlite | ~10KB | ✅ Good | SQLite OAuth implementation |  
| @atxp/base | ~25KB | ✅ Good | Base blockchain integration |
| @atxp/server | ~404KB | 🔴 Large | MCP server with dependencies |
| @atxp/client | ~576KB | 🔴 Large | Client with blockchain libs |

### Size Categories

- ✅ **Good**: < 100KB raw bundle size
- 🟡 **Warning**: 100KB - 500KB raw bundle size  
- 🔴 **Large**: > 500KB raw bundle size

> **Note**: Large sizes for client/server packages are expected due to blockchain and MCP dependencies. The analysis helps track if they grow unexpectedly.

## Optimization Strategies

### Tree Shaking
- Use explicit named exports (already implemented)
- Avoid `export *` patterns
- Mark side-effect-free packages with `"sideEffects": false`

### Code Splitting
- Use dynamic imports for optional features
- Separate blockchain-specific code
- Lazy load large dependencies

### Dependency Management
- Audit large dependencies regularly
- Use smaller alternatives when possible
- Externalize dependencies that consumers should provide

### Bundle Analysis
- Monitor size changes in PRs
- Profile largest modules for optimization opportunities
- Track export usage to identify unused code

## Troubleshooting

### Analysis Not Running
1. Ensure `ANALYZE_BUNDLE=true` environment variable is set
2. Check that `rollup-plugin-analyzer` is installed
3. Verify rollup configuration includes the analyzer plugin

### Missing Analysis Output
1. Check that build completes successfully
2. Look for analysis output in build logs
3. Verify analyzer plugin configuration

### CI Workflow Issues
1. Check workflow file syntax in `.github/workflows/bundle-size.yml`
2. Ensure PR targets correct base branch
3. Check GitHub Actions logs for detailed error messages

## Related Documentation

- [Rollup Plugin Analyzer Documentation](https://www.npmjs.com/package/rollup-plugin-analyzer)
- [Bundle Size Best Practices](https://web.dev/reduce-javascript-payloads-with-tree-shaking/)
- [GitHub Actions Workflow Syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
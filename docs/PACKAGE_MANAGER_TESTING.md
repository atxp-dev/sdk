# Package Manager Integration Testing

This document describes the integration testing setup for ensuring ATXP packages work correctly across different package managers and prevent crypto module loading regressions.

## Overview

The integration tests verify that the `@atxp/common` package works correctly when installed by external consumers using different package managers (npm, pnpm, yarn, bun).

## What Gets Tested

### ✅ Package Managers
- **npm** - Standard Node.js package manager
- **pnpm** - Fast, disk space efficient package manager  
- **yarn** - Alternative package manager with workspaces support
- **bun** - Fast all-in-one JavaScript runtime (when available)

### ✅ Crypto Functionality
- **Environment Detection** - Correct Node.js/browser/React Native detection
- **UUID Generation** - `crypto.randomUUID()` produces valid RFC 4122 UUIDs
- **Hash Generation** - `crypto.digest()` SHA-256 hashing with expected outputs
- **Hex Encoding** - `crypto.toHex()` converts byte arrays to hex strings
- **Consistency** - Same inputs produce same outputs, different inputs differ

### ✅ Cross-Platform Compatibility
- **Linux** (ubuntu-latest)
- **macOS** (macos-latest)  
- **Windows** (windows-latest)
- **Node.js versions** 18, 20, 22

## Running Tests

### Locally

```bash
# Run all package manager integration tests
npm run test:package-managers

# Run all integration tests (includes Redis tests)
npm run test:integration

# Run specific package test manually in atxp-common package
cd packages/atxp-common
npm run test:package-managers
```

### In CI/CD

The tests automatically run on:
- Push to `main` branch
- Pull requests to `main` branch  
- Changes to platform crypto code
- Manual workflow dispatch

## Test Structure

### Test File Location
```
packages/atxp-common/src/platform/packageManager.integration.test.ts
```

### How It Works

1. **Build & Package** - Creates a tarball of the current `@atxp/common` package
2. **Create Test Projects** - Generates temporary external project directories
3. **Install Package** - Uses each package manager to install the tarball
4. **Run Crypto Tests** - Executes crypto functionality tests as external consumer
5. **Validate Results** - Ensures all crypto functions work correctly
6. **Cleanup** - Removes temporary files and directories

### Test Timeout
- **Local**: 2 minutes per package manager test
- **CI**: 2 minutes per package manager test
- **Total runtime**: ~8-10 minutes for all package managers

## Expected Test Output

### Successful Test
```
✅ should work when installed with npm
✅ should work when installed with pnpm  
✅ should work when installed with yarn
✅ should work when installed with bun
```

### Test Failure Indicators
- ❌ `Cannot find module 'crypto'` errors
- ❌ Invalid UUID format errors
- ❌ Hash output mismatches  
- ❌ Environment detection failures
- ❌ Package installation failures

## Adding New Tests

### Test a New Package Manager

1. Add the package manager to the `PACKAGE_MANAGERS` array
2. Add installation command logic in the test
3. Update the GitHub Actions workflow to install the package manager

### Test New Crypto Functionality

1. Add test logic to `CONSUMER_TEST_SCRIPT`
2. Update expected outputs and validation
3. Document new test cases in this file

## Troubleshooting

### Common Issues

**Test Timeout**
- Increase `TEST_TIMEOUT` or `testTimeout` in vitest config
- Check for slow package installations

**Package Manager Not Found**
- Tests automatically skip unavailable package managers
- Install missing package managers for local development

**Hash/UUID Validation Failures**  
- Check for crypto implementation regressions
- Verify Web Crypto API vs Node.js crypto module behavior

**Temporary Directory Cleanup**
- Tests clean up automatically in `afterAll()`
- Manual cleanup: `rm -rf /tmp/atxp-integration-*`

### Debugging

```bash
# Run with verbose output
npm run test:package-managers -- --reporter=verbose

# Run single package manager test
npm run test:package-managers -- --grep "npm"

# Keep temporary directories for inspection
# (modify test to comment out cleanup in afterAll)
```

## CI/CD Integration

### GitHub Actions Workflow
- **File**: `.github/workflows/package-manager-integration.yml`
- **Triggers**: Push/PR to main, manual dispatch
- **Matrix**: Node.js 18/20/22, Ubuntu/macOS/Windows
- **Artifacts**: Test results uploaded on failure

### Status Checks
The package manager integration tests are **required status checks** for:
- Pull requests modifying platform crypto code
- Releases of `@atxp/common` package

## Performance Considerations

- Tests run in parallel across Node.js versions
- Package installations are cached when possible
- Temporary directories are cleaned up promptly
- Tests skip unavailable package managers automatically

## Regression Prevention

These tests prevent regressions by:
1. **Catching crypto loading issues** before they reach consumers
2. **Validating cross-platform compatibility** on multiple OS/Node versions
3. **Testing real-world usage patterns** with actual package installations  
4. **Automated CI/CD integration** prevents broken releases

## Maintenance

- **Update package manager versions** in GitHub Actions regularly
- **Add new Node.js versions** to test matrix as they're released
- **Review test timeouts** if CI becomes slow
- **Update expected test outputs** when crypto behavior changes intentionally
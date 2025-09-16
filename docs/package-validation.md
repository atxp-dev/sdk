# Package Validation and Testing

This document describes the comprehensive package validation and testing system implemented for ATXP packages.

## Overview

The package validation system ensures that all ATXP packages are correctly built, packaged, and can be successfully installed and used by consumers. It includes automated validation, testing, and verification scripts.

## Features Implemented

### 1. Package Scripts

All packages now include these standardized scripts:

- `prepack`: Runs build and typecheck before packaging
- `pack:dry`: Performs a dry-run pack to validate package contents without creating actual tarball

**Example package.json scripts section:**
```json
{
  "scripts": {
    "build": "rollup -c",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "prepack": "npm run build && npm run typecheck",
    "pack:dry": "npm pack --dry-run"
  }
}
```

### 2. Validation Scripts

#### Package Validation Script (`scripts/validate-packages.js`)
Comprehensive validation of package structure and configuration:

- ✅ **Package.json Validation**: Checks required fields, scripts, and structure
- ✅ **Build Artifacts**: Verifies all required dist files exist
- ✅ **TypeScript Declarations**: Ensures .d.ts files are present
- ✅ **Export Maps**: Validates exports configuration
- ✅ **Dependency Management**: Checks for proper peer dependencies
- ✅ **File Inclusion**: Verifies files array includes necessary assets

**Usage:**
```bash
# Validate all packages
npm run validate:packages

# Validate specific package
npm run validate:packages atxp-client
```

#### Package Installation Test (`scripts/test-package-installation.js`)
End-to-end testing of package installation and usage:

- 📦 **Pack Testing**: Creates actual package tarballs
- 📥 **Installation Testing**: Installs packages in isolated environments
- 🧪 **Import Testing**: Verifies packages can be imported and used
- 🧹 **Cleanup**: Automatically cleans up test artifacts

**Usage:**
```bash
# Test all packages
npm run test:package-install

# Test specific package
npm run test:package-install atxp-server
```

### 3. Root Scripts

New scripts added to root package.json for monorepo management:

```json
{
  "scripts": {
    "validate:packages": "node scripts/validate-packages.js",
    "test:package-install": "node scripts/test-package-installation.js",
    "pack:all": "npm run pack:dry --workspaces --if-present",
    "prepack:all": "npm run prepack --workspaces --if-present"
  }
}
```

## Validation Checks

### Required Package Fields
- `name`, `version`, `description`, `license`
- `type: "module"` for ESM support
- `main`, `module`, `types` entry points
- `exports` map configuration
- `files` array including "dist"

### Required Scripts
- `build`: Build the package
- `typecheck`: TypeScript type checking
- `lint`: Code linting
- `test`: Run tests
- `prepack`: Pre-packaging validation
- `pack:dry`: Dry-run packaging

### Required Build Artifacts
- `dist/index.js`: ESM entry point
- `dist/index.cjs`: CommonJS entry point
- `dist/index.d.ts`: TypeScript declarations

### Export Map Validation
- `types`: Points to declaration files
- `import`: Points to ESM build
- `require`: Points to CommonJS build

## How It Works

### Prepack Process
When `npm pack` is run (or triggered by `npm publish`):

1. **prepack script runs automatically**
   - Builds the package (`npm run build`)
   - Runs type checking (`npm run typecheck`)
   - Fails if build or types have errors

2. **Package creation**
   - Creates tarball with only files listed in `files` array
   - Includes `dist/` directory with build artifacts

### Installation Testing Process
The installation test script:

1. **Validates package** using pack dry-run
2. **Creates actual package** with `npm pack`
3. **Sets up test environment** in temporary directory
4. **Installs package** from tarball
5. **Tests imports** to verify package works
6. **Cleans up** test artifacts

### Continuous Validation
- All builds now run validation before completion
- Pack dry-run ensures packages are valid before publishing
- Installation tests verify end-to-end functionality

## Benefits

### For Development
- ✅ **Early Error Detection**: Catches packaging issues before publishing
- ✅ **Consistent Structure**: Ensures all packages follow same patterns
- ✅ **Automated Validation**: Reduces manual testing overhead

### For Consumers
- ✅ **Reliable Packages**: Guaranteed to install and import correctly
- ✅ **Proper TypeScript Support**: Declaration files always included
- ✅ **Correct Module Support**: Both ESM and CommonJS entry points

### for CI/CD
- ✅ **Automated Checks**: Can be integrated into CI pipelines
- ✅ **Fast Feedback**: Quick validation without full publish cycle
- ✅ **Comprehensive Coverage**: Tests entire package lifecycle

## Usage Examples

### Development Workflow
```bash
# During development
npm run build              # Build packages
npm run validate:packages  # Validate package structure

# Before publishing
npm run pack:all          # Dry-run pack all packages
npm run test:package-install  # Test installation process
```

### CI Integration
```bash
# In CI pipeline
npm run build
npm run validate:packages
npm run test:package-install
# Only publish if all validations pass
```

### Single Package Testing
```bash
# Test specific package
npm run validate:packages atxp-client
npm run test:package-install atxp-client

# In package directory
npm run prepack    # Build and typecheck
npm run pack:dry   # Test packaging
```

## Error Handling

The validation scripts provide detailed error messages:

- **Validation Errors**: Missing fields, invalid structure, missing files
- **Build Errors**: TypeScript errors, build failures
- **Installation Errors**: Package installation or import failures
- **Warnings**: Best practice suggestions, dependency recommendations

## Integration with Existing Workflow

This system integrates seamlessly with existing package management:

- **Existing Scripts**: All existing scripts continue to work unchanged
- **Build Process**: Uses existing rollup build configuration
- **Publishing**: Works with existing `npm publish` workflow
- **Development**: Adds validation without disrupting dev experience

The validation system ensures that ATXP packages are always correctly built, properly configured, and ready for consumer use.
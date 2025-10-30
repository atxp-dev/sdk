# Polygon Chain Support Implementation Plan

**Linear Issue:** [ATXP-525](https://linear.app/circuitandchisel/issue/ATXP-525)
**Goal:** Add Polygon as a supported EVM chain with full feature parity to Base and World chains

## Overview

This document outlines the phased approach for adding Polygon support to the ATXP SDK. The implementation will mirror the existing Base and World chain architecture, prioritizing mainnet support with optional testnet (Amoy) support.

### Key Decisions

- **Networks:** Polygon mainnet (Chain ID 137) required, Amoy testnet (Chain ID 80002) nice-to-have
- **Infrastructure:** Coinbase CDP bundler/paymaster (consistent with Base)
- **USDC Contract:** Native USDC on Polygon (`0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`)
- **Wallet Support:** Standard wallet integration (MetaMask, WalletConnect, etc.)
- **Development Process:** Feature branches → PR review → Merge (after tests/typecheck/lint pass)

---

## Phase 1: Core Configuration & Type Updates

**Objective:** Establish fundamental Polygon support in shared types and constants

### Tasks

1. **Create Polygon Constants File**
   - Location: `/packages/atxp-client/src/polygonConstants.ts`
   - Contents:
     - Polygon mainnet chain ID (137)
     - USDC contract address: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`
     - Helper function: `getPolygonUSDCAddress(chainId: number)`
     - Chain configuration object (RPC URLs, block explorer, native currency)
   - Reference: `baseConstants.ts` and `worldConstants.ts` for structure

2. **Update Network Type Definition**
   - Location: `/packages/atxp-common/src/types.ts:23`
   - Change: Add `'polygon'` to the `Network` type union
   - Current: `'solana' | 'base' | 'world' | ...`
   - Updated: `'solana' | 'base' | 'world' | 'polygon' | ...`

3. **Export Polygon Constants**
   - Location: `/packages/atxp-client/src/index.ts`
   - Add exports for Polygon constants similar to Base/World exports

### Validation Criteria

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] No breaking changes to existing chain support

### Deliverable

Polygon is recognized as a valid network type throughout the codebase.

---

## Phase 2: Polygon Package - Mainnet Support

**Objective:** Create complete `@atxp/polygon` package with mainnet functionality

### Tasks

1. **Create Package Structure**
   - Location: `/packages/atxp-polygon/`
   - Files to create:
     ```
     packages/atxp-polygon/
     ├── package.json
     ├── tsconfig.json
     ├── rollup.config.js
     ├── README.md
     └── src/
         ├── index.ts
         ├── polygonAccount.ts
         ├── polygonPaymentMaker.ts
         ├── mainWalletPaymentMaker.ts
         ├── smartWalletHelpers.ts
         ├── spendPermissionShim.ts
         ├── cache.ts
         ├── types.ts
         ├── testHelpers.ts
         └── *.test.ts files
     ```
   - Reference: Copy and adapt from `/packages/atxp-base/`

2. **Implement Core Classes**

   **PolygonAccount** (`polygonAccount.ts`):
   - Implements `Account` interface from `@atxp/client`
   - Static `initialize()` method with parameters:
     - `walletAddress: string`
     - `provider: any`
     - `chainId: number` (137 for mainnet)
     - `allowance?: number` (default: 10 USDC)
     - `periodInDays?: number` (default: 7 days)
     - `useEphemeralWallet?: boolean`
     - `cache?: Cache`
   - Manages payment maker selection (ephemeral vs main wallet)

   **PolygonPaymentMaker** (`polygonPaymentMaker.ts`):
   - Ephemeral wallet implementation
   - Uses spend permissions + smart wallet
   - Creates USDC transfer transactions
   - Implements JWT generation for authentication
   - Integrates with Coinbase CDP bundler/paymaster

   **MainWalletPaymentMaker** (`mainWalletPaymentMaker.ts`):
   - Direct wallet transaction implementation
   - Fallback for users who prefer traditional wallet approval

3. **Configure Smart Wallet Infrastructure**
   - File: `smartWalletHelpers.ts`
   - Functions:
     - `toEphemeralSmartWallet()` - Creates smart wallet from private key
     - Configure bundler URL for Polygon mainnet (Coinbase CDP)
     - Configure paymaster URL for Polygon mainnet (Coinbase CDP)
   - Note: Verify Coinbase CDP supports Polygon chain ID 137

4. **Implement Spend Permissions**
   - File: `spendPermissionShim.ts`
   - Functions:
     - `requestSpendPermission()` - Request permission from user's wallet
     - `prepareSpendCallData()` - Prepare transaction data

5. **Add Caching Support**
   - File: `cache.ts`
   - Implement browser/memory caching for permissions
   - Reference: `atxp-base/src/cache.ts`

6. **Create Tests**
   - Account initialization tests
   - Ephemeral wallet payment tests
   - Main wallet payment tests
   - Smart wallet creation tests
   - Spend permission tests
   - Environment configuration tests

7. **Write Documentation**
   - File: `README.md`
   - Sections:
     - Installation instructions
     - Quick start guide
     - API reference
     - Configuration options
     - React integration examples
     - Error handling patterns
     - Troubleshooting

8. **Update Package.json**
   - Dependencies:
     - `@atxp/client`
     - `@atxp/common`
     - `viem`
     - `bignumber.js`
   - Scripts:
     - `build`
     - `test`
     - `typecheck`
     - `lint`

### Validation Criteria

- [ ] All tests pass (`npm run test`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Linting passes (`npm run lint`)
- [ ] Bundle builds successfully (`npm run build`)
- [ ] Manual testing: Ephemeral wallet payment on Polygon mainnet succeeds
- [ ] Manual testing: Main wallet payment on Polygon mainnet succeeds
- [ ] Documentation is complete and accurate

### Deliverable

Fully functional `@atxp/polygon` package with mainnet support.

---

## Phase 3: Amoy Testnet Support (Nice to Have)

**Objective:** Add testnet support for development and testing

### Tasks

1. **Extend Polygon Constants**
   - Location: `/packages/atxp-client/src/polygonConstants.ts`
   - Add:
     - Amoy testnet chain ID (80002)
     - Amoy USDC contract address
     - Update `getPolygonUSDCAddress()` to handle testnet
     - Add Amoy chain configuration object

2. **Update Network Type**
   - Location: `/packages/atxp-common/src/types.ts`
   - Add `'polygon_amoy'` to the `Network` type union

3. **Configure Testnet Infrastructure**
   - Location: `/packages/atxp-polygon/src/smartWalletHelpers.ts`
   - Add Coinbase CDP bundler/paymaster URLs for Amoy (chain ID 80002)
   - Handle testnet-specific configurations

4. **Expand Tests**
   - Add testnet-specific test cases
   - Verify testnet USDC address resolution
   - Test smart wallet creation on Amoy

5. **Update Documentation**
   - Add Amoy testnet instructions to README
   - Include testnet faucet links
   - Add testnet example code

### Validation Criteria

- [ ] All tests pass for both mainnet and testnet
- [ ] Type checking passes
- [ ] Linting passes
- [ ] Manual testing: Testnet payments work on Amoy
- [ ] Documentation includes testnet setup

### Deliverable

Complete testnet support for Polygon Amoy.

---

## Phase 4: Integration & Documentation

**Objective:** Integrate Polygon package into the monorepo ecosystem

### Tasks

1. **Update Monorepo Configuration**
   - Location: Root `package.json`
   - Add `packages/atxp-polygon` to workspaces
   - Update build scripts to include Polygon package
   - Update `npm run test` to include Polygon tests
   - Update `npm run typecheck` to include Polygon

2. **CI/CD Pipeline Updates**
   - Ensure Polygon package is included in CI builds
   - Add Polygon tests to test pipeline
   - Verify bundle size tracking includes Polygon

3. **Update Examples**
   - Location: `/examples/multichain/`
   - Add Polygon to multi-chain example if applicable
   - Consider creating Polygon-specific example

4. **Update Root Documentation**
   - Add Polygon to supported chains list in main README
   - Update any comparison tables or feature matrices
   - Add migration guide if needed

5. **Integration Testing**
   - Test Polygon alongside Base and World in multi-chain scenarios
   - Verify server-side network resolution includes Polygon
   - Test payment flows end-to-end

6. **Bundle Size Validation**
   - Run bundle size analysis
   - Compare with Base/World packages
   - Optimize if necessary

### Validation Criteria

- [ ] Full monorepo test suite passes
- [ ] CI/CD pipeline succeeds with Polygon included
- [ ] Bundle sizes are reasonable and documented
- [ ] All documentation is updated
- [ ] Integration tests pass
- [ ] No regressions in existing Base/World functionality

### Deliverable

Polygon fully integrated into ATXP SDK with complete documentation.

---

## Development Workflow

### Branch Strategy

Each phase will be developed on a feature branch:
- Phase 1: `feature/polygon-phase-1-constants`
- Phase 2: `feature/polygon-phase-2-package`
- Phase 3: `feature/polygon-phase-3-testnet`
- Phase 4: `feature/polygon-phase-4-integration`

### Pre-PR Checklist

Before pushing a PR, ensure:
- [ ] `npm run test` - All tests pass
- [ ] `npm run typecheck` - Type checking passes
- [ ] `npm run lint` - Linting passes
- [ ] `npm run build` - Build succeeds
- [ ] Manual testing completed for new functionality
- [ ] Documentation updated
- [ ] Commit messages are clear and descriptive

### PR Review Process

1. Push feature branch to GitHub
2. Create PR with detailed description
3. Link to corresponding Linear sub-issue
4. Request review from team
5. Address review feedback
6. Merge after approval

---

## Key Technical References

### USDC Addresses

- **Polygon Mainnet (137):** `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` (Native USDC)
- **Polygon Amoy (80002):** TBD - verify current testnet USDC address

### Coinbase CDP Infrastructure

- **Bundler:** Verify Coinbase CDP supports Polygon
- **Paymaster:** Verify gas sponsorship available for Polygon
- **Smart Wallet:** Use Coinbase smart wallet implementation

### Reference Implementations

- **Primary Reference:** `/packages/atxp-base/` - Use as main template
- **Secondary Reference:** `/packages/atxp-worldchain/` - Alternative patterns
- **Constants Pattern:** `baseConstants.ts` and `worldConstants.ts`

---

## Risk Mitigation

### Potential Issues

1. **Coinbase CDP Polygon Support**
   - Risk: Coinbase CDP may not support Polygon chain
   - Mitigation: Verify support early in Phase 2; have fallback infrastructure ready (Pimlico, Biconomy)

2. **USDC Contract Differences**
   - Risk: Native USDC on Polygon may have different interface
   - Mitigation: Test thoroughly; review USDC contract documentation

3. **Gas Estimation**
   - Risk: Polygon gas dynamics differ from Base
   - Mitigation: Test gas estimation; adjust parameters if needed

4. **RPC Reliability**
   - Risk: Public Polygon RPCs may have rate limits
   - Mitigation: Document recommended RPC providers; support custom RPC URLs

---

## Success Criteria

The implementation is complete when:

1. ✅ Polygon mainnet is fully supported with both ephemeral and main wallet modes
2. ✅ All tests pass for Polygon package
3. ✅ Documentation is complete and accurate
4. ✅ Integration with existing ATXP infrastructure is seamless
5. ✅ CI/CD pipeline includes Polygon validation
6. ✅ (Optional) Amoy testnet support is functional

---

## Timeline Estimate

- **Phase 1:** 1-2 days
- **Phase 2:** 3-5 days
- **Phase 3:** 1-2 days (if pursued)
- **Phase 4:** 1-2 days

**Total:** ~1-2 weeks for complete implementation with testnet support

---

## Maintenance & Future Considerations

### Post-Launch

- Monitor Polygon network upgrades
- Track USDC contract updates
- Maintain Coinbase CDP integration
- Update documentation as needed

### Future Enhancements

- Support for other Polygon chains (zkEVM)
- Additional token support beyond USDC
- Enhanced gas optimization strategies
- Polygon-specific wallet integrations (if needed)

# Architecture Update Summary

## Date: 2025-10-16

## User Approval

**User's Decision**: "Yep, let's update the doc with this."

The user approved the proposal to have `getSourceAddress()` return an array of `{network, address}` objects instead of the two-phase discovery approach or network parameter approach.

## Changes Made to ARCHITECTURE.md

### 1. Updated PaymentMaker Interface (Multiple Locations)

**Changed From**:
```typescript
getSourceAddress(params): Promise<string>
```

**Changed To**:
```typescript
getSourceAddress(params: {
  amount: BigNumber,
  currency: Currency,
  receiver: string,
  memo: string
}): Promise<Array<{network: Network, address: string}>>
```

**Added Optional Field**:
```typescript
supportedNetworks?: Network[];  // For documentation/IDE hints
```

### 2. Completely Rewrote Section 11

**Old Title**: "Multi-Network PaymentMaker Support" with Options A-D analysis

**New Title**: "Multi-Network PaymentMaker Support (APPROVED SOLUTION)"

**New Content**:
- Approved array return solution as the only approach
- Detailed implementation examples for BasePaymentMaker, SolanaPaymentMaker, ATXPHttpPaymentMaker
- Complete flow example showing efficiency (4 calls vs. 7+ calls with network parameter)
- Edge case handling
- Migration strategy
- Comparison table showing why array return is best

### 3. Updated ATXPDestinationMapper Implementation

**Changed From**: Two-phase discovery approach
```typescript
// PHASE 1: DISCOVERY - GET request
// PHASE 2: COLLECTION - Get addresses per network
// PHASE 3: EXECUTION - POST with addresses
```

**Changed To**: Single-phase array collection approach
```typescript
// PHASE 1: COLLECT ALL SOURCE ADDRESSES (arrays from each PM)
// PHASE 2: SEND ALL ADDRESSES TO ACCOUNTS SERVICE
```

**Key Changes**:
- No more discovery GET request
- Call each PaymentMaker's `getSourceAddress()` once
- Each PM returns array of `{network, address}` pairs
- Merge all arrays into single `buyerAddresses` object
- Single POST to accounts service with all addresses

### 4. Added Section 12: Architecture Status & Final Decisions

New section documenting:
- **Status**: FINALIZED AND APPROVED ✅
- All key architecture decisions with approval status
- Breaking changes summary
- Implementation timeline (2-3 weeks)
- Success criteria
- Risk mitigation
- Next actions

### 5. Updated DestinationMapper Interface Documentation

**Changed From**:
```
Uses two-phase discovery:
1. Discovery: GET to learn what networks are supported
2. Collection: Get buyer addresses for networks that need them
3. Execution: POST with all buyer addresses to get concrete destinations
```

**Changed To**:
```
Uses single-phase approach with array return:
1. Collection: Get source addresses from all PaymentMakers (each returns array of {network, address})
2. Execution: POST with all collected buyer addresses to get concrete destinations
```

### 6. Updated Accounts Service API Documentation

**Clarified**:
- **GET /addresses** endpoint already exists and returns array format ✅
- **No new endpoints needed** (no `/address_for_payment` required)
- **POST /payment_info** already accepts `buyerAddresses: Record<Network, string>` ✅

### 7. Removed Outdated Analysis Documents

Deleted:
- `TWO_PHASE_ANALYSIS.md`
- `RECOMMENDATION.md`
- `EXECUTIVE_SUMMARY.md`

These documents recommended the single-phase approach but analyzed the two-phase approach extensively. They are now obsolete since the final decision is made.

## Key Benefits of Approved Approach

1. **Beautiful Symmetry**: Both `getSourceAddress()` and accounts service `/addresses` return arrays
2. **Most Efficient**: 1 call per PaymentMaker (vs. N calls per network)
3. **Uses Existing Infrastructure**: No new accounts service endpoints needed
4. **Simpler Code**: Mapper just collects and merges arrays
5. **Natural for Multi-Network**: ATXP PM returns all addresses at once
6. **Works for Single-Network**: Return array with one item

## Implementation Examples

### BasePaymentMaker (Single-Network)
```typescript
async getSourceAddress(params): Promise<Array<{network, address}>> {
  return [{network: 'base', address: this.wallet.address}];
}
```

### ATXPHttpPaymentMaker (Multi-Network)
```typescript
async getSourceAddress(params): Promise<Array<{network, address}>> {
  // Call existing GET /addresses endpoint
  const response = await this.fetchFn(`${this.origin}/addresses`, {...});
  const data = await response.json();
  return data.addresses;  // Returns [{network: 'base', address: '0x...'}, {network: 'solana', address: 'Sol...'}, ...]
}
```

### ATXPDestinationMapper
```typescript
async mapDestination(destination): Promise<PaymentDestination[] | null> {
  const allSourceAddresses: Record<Network, string> = {};

  // Collect from all PaymentMakers
  for (const pm of this.paymentMakers.values()) {
    const addresses = await pm.getSourceAddress({...});  // Returns array
    for (const {network, address} of addresses) {
      allSourceAddresses[network] = address;
    }
  }

  // Single POST with all addresses
  const response = await this.fetchFn(paymentInfoUrl, {
    method: 'POST',
    body: JSON.stringify({paymentRequestId, buyerAddresses: allSourceAddresses})
  });

  return response.destinations;
}
```

## Breaking Changes

1. **PaymentMaker.getSourceAddress()** return type changed
2. All PaymentMaker implementations must be updated
3. Minor version bump required: 0.7.x → 0.8.0

## No Backend Changes Required

- Accounts service GET /addresses already returns array format ✅
- Accounts service POST /payment_info already accepts buyerAddresses object ✅
- No new endpoints needed ✅

## Status

**Architecture**: FINALIZED ✅
**Ready for Implementation**: YES ✅
**Estimated Timeline**: 2-3 weeks
**Next Step**: Create implementation PR with Phase 1 changes

## Files Modified

- `/Users/bdj/pr0xy/sdk-payment-maker-refactor/ARCHITECTURE.md` - Comprehensive updates throughout
  - Section 1.2: Updated PaymentMaker interface
  - Section 3.2: Updated PaymentMaker interface with array return
  - Section 3.3: Updated DestinationMapper documentation
  - Section 11: Completely rewritten with approved solution
  - Section 12: New section documenting final status

## Files Deleted

- TWO_PHASE_ANALYSIS.md
- RECOMMENDATION.md
- EXECUTIVE_SUMMARY.md
- SECTION_11_NEW.md (temporary file)

## Verification

Run these commands to verify consistency:
```bash
# Check for old string return type (should only be in "before" examples in Section 11)
grep -n "getSourceAddress.*Promise<string>" ARCHITECTURE.md

# Check for array return type (should be in multiple places)
grep -n "getSourceAddress.*Array" ARCHITECTURE.md

# Check for two-phase references (should only be in historical context)
grep -i "two-phase" ARCHITECTURE.md

# Check for array return benefits
grep -i "beautiful symmetry" ARCHITECTURE.md
```

## Ready for Implementation

The architecture is now:
- ✅ Consistent throughout the document
- ✅ Approved by user
- ✅ Ready for implementation
- ✅ Clear on breaking changes
- ✅ Clear on migration path
- ✅ Clear on timeline

**Next step**: Begin Phase 1 implementation (update PaymentMaker interface).

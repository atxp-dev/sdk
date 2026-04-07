# Local SDK Setup Notes

## Dual-Remote Configuration

This local clone (`../sdk`) points to the **real** SDK repo at `atxp-dev/sdk` (remote: `origin`). A second remote `circuitandchisel` has been added pointing to `circuitandchisel/sdk`, which is a standalone copy (not a GitHub fork) of the same repo with identical `main` history.

### Why this exists

An AI agent that wrote the multi-protocol phase 1 code didn't have push access to `atxp-dev/sdk`, so it created `circuitandchisel/sdk` and pushed feature branches there. The feature branches in `circuitandchisel/sdk` are based on the same `main` as `atxp-dev/sdk`.

### Remotes

- `origin` = `atxp-dev/sdk` (the real, canonical SDK repo)
- `circuitandchisel` = `circuitandchisel/sdk` (copy with phase 1+ feature branches)

### Feature branches from circuitandchisel remote

- `feature/phase1-sdk-client` — PR circuitandchisel/sdk#2: feature flags + unified fetcher with X402 + ATXP strategy pattern
- `feature/phase1-sdk-server` — server-side phase 1 work
- `feature/phase3-sdk-server-mpp` — phase 3 server MPP
- `feature/phase3-sdk-tempo-mpp-client` — phase 3 Tempo MPP client

### Workflow

1. Test and iterate on branches locally (tracking `circuitandchisel` remote)
2. When ready to merge, push the branch to `origin` (`atxp-dev/sdk`) and open a PR there
3. The branches will apply cleanly since both remotes share the same `main`

### Related PRs (multi-protocol phase 1)

- **accounts** PR #624 (`feat/multi-protocol-phase1-accounts`): POST /authorize/x402 + POST /authorize/atxp
- **auth** PR #228 (`feature/phase1-auth-verify-settle`): POST /verify/x402, /settle/x402, /verify/atxp, /settle/atxp
- **sdk** circuitandchisel/sdk PR #2 (`feature/phase1-sdk-client`): feature flag types + unified fetcher

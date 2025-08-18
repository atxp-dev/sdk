# GitHub Actions Workflows

## test.yml - Node.js Tests with Redis Integration

This workflow runs comprehensive tests for the ATXP OAuth database implementations, including integration tests against a real Redis instance.

### Workflow Steps

1. **Setup**: Checkout code, setup Node.js 22.x, install dependencies
2. **Build & Lint**: Run build, typecheck, and linting
3. **Unit Tests**: Run all unit tests (Redis integration tests are skipped)
4. **Redis Setup**: Start Redis 7-alpine service container
5. **Redis Verification**: Install Redis CLI and verify connectivity
6. **Integration Tests**: Run Redis OAuth database integration tests

### Redis Service Configuration

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - 6379:6379
    options: >-
      --health-cmd "redis-cli ping"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

**Features:**
- Uses Redis 7 Alpine image for lightweight, fast startup
- Health checks ensure Redis is ready before tests run
- Maps Redis port 6379 to localhost for test connectivity
- Automatic cleanup after workflow completion

### Integration Tests Covered

The Redis integration tests verify:

- ✅ **CRUD Operations**: Client credentials, PKCE values, access tokens
- ✅ **TTL Behavior**: Automatic expiration and cleanup
- ✅ **Encryption**: Data encryption/decryption in Redis
- ✅ **Factory Integration**: Creating Redis instances from URLs
- ✅ **Data Persistence**: Cross-instance data survival
- ✅ **Namespace Isolation**: Key prefix separation

### Triggering the Workflow

The workflow runs on:
- **Pull Requests** targeting the `main` branch
- **Pushes** to the `main` branch

### Environment Variables

- `REDIS_URL=redis://localhost:6379` - Set for integration tests
- `NPM_TOKEN` - For private npm registry access (if needed)

### Troubleshooting

**Redis Connection Issues:**
- Health checks ensure Redis is ready before tests
- Redis CLI verification step shows connection status
- Integration tests have built-in timeout handling

**Test Failures:**
- Unit tests run first, so basic functionality is verified
- Integration tests are separate, so Redis issues don't block other tests
- Verbose output shows detailed test results

### Local Development

To run the same tests locally:

```bash
# Start Redis (Docker)
docker run -d -p 6379:6379 --name redis-test redis:7-alpine

# Run integration tests
REDIS_URL=redis://localhost:6379 npm test -- src/redisOAuthDb.integration.test.ts

# Cleanup
docker stop redis-test && docker rm redis-test
```
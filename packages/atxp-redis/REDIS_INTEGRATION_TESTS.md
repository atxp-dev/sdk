# Redis Integration Tests

This package includes integration tests that run against a real Redis instance when the `REDIS_URL` environment variable is set.

## Running Integration Tests

### Prerequisites
- Redis server running and accessible
- Connection details available

### Running Tests

```bash
# Run all tests (unit tests only, integration tests skipped)
npm test

# Run integration tests with local Redis
REDIS_URL=redis://localhost:6379 npm run test:integration

# Run integration tests with remote Redis
REDIS_URL=redis://username:password@redis-host:6379 npm run test:integration

# Run integration tests with Redis over TLS
REDIS_URL=rediss://username:password@redis-host:6380 npm run test:integration

# From monorepo root
REDIS_URL=redis://localhost:6379 npm run test:integration
```

### Docker Redis for Testing

If you don't have Redis installed locally, you can use Docker:

```bash
# Start Redis in Docker
docker run -d -p 6379:6379 --name redis-test redis:latest

# Run integration tests
REDIS_URL=redis://localhost:6379 npm run test:integration

# Stop and remove the container
docker stop redis-test && docker rm redis-test
```

## What the Integration Tests Cover

The integration tests verify:

1. **Basic CRUD Operations**
   - Client credentials storage and retrieval
   - PKCE values storage and retrieval  
   - Access token storage and retrieval

2. **TTL Behavior**
   - PKCE values automatically expire (10 minutes)
   - Access tokens respect configured TTL
   - Expired tokens are automatically cleaned up

3. **Encryption Support**
   - Data is properly encrypted in Redis
   - Decryption works correctly on retrieval

4. **Direct Database Creation**
   - `RedisOAuthDb` instances work correctly with connection URLs

5. **Error Handling**
   - Connection failures are handled gracefully
   - Operations timeout appropriately
   - Cleanup works even with failed connections

## Test Data Cleanup

The integration tests:
- Use unique key prefixes with timestamps to avoid conflicts
- Automatically clean up all test data after each test
- Handle cleanup gracefully even if Redis connection fails

## CI/CD Integration

In CI environments, you can:

```yaml
# Example GitHub Actions
- name: Start Redis
  uses: supercharge/redis-github-action@1.4.0
  with:
    redis-version: 7

- name: Run Integration Tests
  run: REDIS_URL=redis://localhost:6379 npm test
  env:
    REDIS_URL: redis://localhost:6379
```

## Troubleshooting

**Tests are skipped**: Make sure `REDIS_URL` environment variable is set.

**Connection timeouts**: Verify Redis is running and accessible at the specified URL.

**Permission errors**: Ensure the Redis user has read/write permissions.

**SSL/TLS issues**: Use `rediss://` URLs for TLS connections and verify certificates.
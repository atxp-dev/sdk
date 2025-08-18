# Environment Variables

This document provides detailed information about all environment variables used by the ATXP SDK.

## Required Environment Variables

### `ATXP_AUTH_CLIENT_TOKEN`

**Required for server-side payment operations**

This token is used to authenticate with the ATXP authorization server for payment-related operations. It must be set when using the `ATXPPaymentServer` class.

**Type**: String  
**Required**: Yes (for payment operations)  
**Default**: None  

**Usage**: This token is automatically used in the `makeRequest` method of `ATXPPaymentServer` to authenticate API calls to the ATXP server.

**Example**:
```bash
ATXP_AUTH_CLIENT_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Error**: If not set, the SDK will throw an error: `ATXP_AUTH_CLIENT_TOKEN is not set`

### `SOLANA_ENDPOINT`

**Required for Solana payment operations**

The RPC endpoint URL for the Solana network you want to use.

**Type**: String (URL)  
**Required**: Yes (for Solana payments)  
**Default**: None  

**Examples**:
```bash
# Mainnet
SOLANA_ENDPOINT=https://api.mainnet-beta.solana.com

# Devnet
SOLANA_ENDPOINT=https://api.devnet.solana.com

# Testnet
SOLANA_ENDPOINT=https://api.testnet.solana.com

# Local development
SOLANA_ENDPOINT=http://localhost:8899
```

### `SOLANA_PRIVATE_KEY`

**Required for Solana payment operations**

The private key for the Solana account that will be used for payments. Must be in base58 format.

**Type**: String (base58 encoded)  
**Required**: Yes (for Solana payments)  
**Default**: None  

**Example**:
```bash
SOLANA_PRIVATE_KEY=4NwwCq5NpFNiJsQdujqvHKndryLPXfcE5xytJP7mKTxP...
```

**Security Note**: Never commit private keys to version control. Use environment variables or secure secret management systems.

## Optional Environment Variables

### `NODE_ENV`

Controls the behavior of the SDK based on the environment.

**Type**: String  
**Required**: No  
**Default**: `development`  
**Values**: `development`, `production`, `test`  

**Effects**:
- `development`: Enables development features like HTTP requests, detailed logging
- `production`: Enforces HTTPS, production security settings, minimal logging
- `test`: Optimized for testing environment

**Example**:
```bash
NODE_ENV=production
```

### `DEBUG`

Enables debug logging when set to any value.

**Type**: String  
**Required**: No  
**Default**: Not set  

**Example**:
```bash
DEBUG=1
# or
DEBUG=true
# or
DEBUG=atxp:*
```

## Environment Setup Examples

### Development Environment

```bash
# .env file for development
NODE_ENV=development
DEBUG=1
SOLANA_ENDPOINT=https://api.devnet.solana.com
SOLANA_PRIVATE_KEY=your_devnet_private_key
ATXP_AUTH_CLIENT_TOKEN=your_dev_auth_token
```

### Production Environment

```bash
# .env file for production
NODE_ENV=production
SOLANA_ENDPOINT=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=your_mainnet_private_key
ATXP_AUTH_CLIENT_TOKEN=your_prod_auth_token
```

### Testing Environment

```bash
# .env.test file
NODE_ENV=test
SOLANA_ENDPOINT=https://api.testnet.solana.com
SOLANA_PRIVATE_KEY=your_testnet_private_key
ATXP_AUTH_CLIENT_TOKEN=your_test_auth_token
```

## Platform-Specific Setup

### Vercel Deployment

For Vercel deployments, set environment variables in the Vercel dashboard:

1. Go to your project in the Vercel dashboard
2. Navigate to Settings → Environment Variables
3. Add each required variable:
   - `ATXP_AUTH_CLIENT_TOKEN`
   - `SOLANA_ENDPOINT`
   - `SOLANA_PRIVATE_KEY`
   - `NODE_ENV` (set to `production`)

### Docker Deployment

```dockerfile
# Dockerfile example
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Set environment variables
ENV NODE_ENV=production
ENV SOLANA_ENDPOINT=https://api.mainnet-beta.solana.com

# Note: Set sensitive variables at runtime
# docker run -e ATXP_AUTH_CLIENT_TOKEN=... -e SOLANA_PRIVATE_KEY=... your-app
```

### Kubernetes Deployment

```yaml
# kubernetes-deployment.yaml example
apiVersion: apps/v1
kind: Deployment
metadata:
  name: atxp-app
spec:
  template:
    spec:
      containers:
      - name: atxp-app
        image: your-app:latest
        env:
        - name: NODE_ENV
          value: "production"
        - name: SOLANA_ENDPOINT
          value: "https://api.mainnet-beta.solana.com"
        - name: ATXP_AUTH_CLIENT_TOKEN
          valueFrom:
            secretKeyRef:
              name: atxp-secrets
              key: auth-token
        - name: SOLANA_PRIVATE_KEY
          valueFrom:
            secretKeyRef:
              name: atxp-secrets
              key: private-key
```

## Troubleshooting

### Common Issues

1. **"ATXP_AUTH_CLIENT_TOKEN is not set"**
   - Ensure the environment variable is properly set
   - Check that your `.env` file is being loaded
   - Verify the variable name spelling

2. **"Invalid Solana endpoint"**
   - Ensure the SOLANA_ENDPOINT is a valid URL
   - Check network connectivity to the endpoint
   - Verify the endpoint is accessible from your deployment environment

3. **"Invalid private key format"**
   - Ensure the private key is in base58 format
   - Check that the key hasn't been corrupted or truncated
   - Verify you're using the correct key for the intended network

### Validation

You can validate your environment setup by running:

```bash
# Check if all required variables are set
node -e "
const required = ['ATXP_AUTH_CLIENT_TOKEN', 'SOLANA_ENDPOINT', 'SOLANA_PRIVATE_KEY'];
const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('Missing required environment variables:', missing);
  process.exit(1);
}
console.log('All required environment variables are set');
"
```

## Security Best Practices

1. **Never commit secrets to version control**
   - Use `.env` files (added to `.gitignore`)
   - Use platform-specific secret management
   - Use Kubernetes secrets or Docker secrets

2. **Use different tokens for different environments**
   - Development tokens for development
   - Production tokens for production
   - Test tokens for testing

3. **Rotate tokens regularly**
   - Implement token rotation policies
   - Monitor token usage and expiration

4. **Limit token permissions**
   - Use tokens with minimal required permissions
   - Avoid using admin tokens for application operations

5. **Monitor and log**
   - Log authentication attempts
   - Monitor for unusual token usage patterns
   - Set up alerts for failed authentication

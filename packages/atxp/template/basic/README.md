# ATXP Basic Client Demo

This is a basic ATXP client demo that shows how to use the `@atxp/client` library to interact with MCP servers using ATXP payments.

## Features

- Uses the `atxpClient` function to create a proper MCP client
- Handles OAuth authentication automatically
- Processes payments through ATXP when required
- Supports multiple MCP servers
- Configurable Solana account for payments

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   Edit the `.env` file and set:
   - `SOLANA_ENDPOINT`: Your Solana RPC endpoint
   - `SOLANA_PRIVATE_KEY`: Your Solana private key
   - `ATXP_AUTH_CLIENT_TOKEN`: Your ATXP auth token (optional)

## Usage

### Development Mode
```bash
npm run dev
```

### Build and Run
```bash
npm run build
npm start
```

### With Arguments
```bash
npm run dev -- [server-url] [tool-name] [arg1=value1] [arg2=value2]
```

## Examples

### Basic Tool Call
```bash
npm run dev -- http://localhost:3009 hello_world name=Alice
```

### With Multiple Arguments
```bash
npm run dev -- http://localhost:3009 secure-data message=hello user=alice
```

## Configuration

The demo uses the following configuration:
- **Account**: `atxp`
- **Payment Network**: Solana
- **Currency**: USDC
- **Authorization Server**: `http://localhost:3010`

## Error Handling

The application includes comprehensive error handling for:
- Missing environment variables
- Network errors
- Payment failures
- Authentication errors

## Database

The application uses SQLite to store OAuth tokens and client credentials. The database file is created automatically.

## Security Notes

- Never commit your private keys to version control
- Use environment variables for sensitive configuration
- The database file contains encrypted tokens - keep it secure
- Consider using a dedicated wallet for this application

## Troubleshooting

### Missing Environment Variables
Make sure your `.env` file contains:
```
SOLANA_ENDPOINT=https://api.devnet.solana.com
SOLANA_PRIVATE_KEY=your_private_key_here
ATXP_AUTH_CLIENT_TOKEN=your_auth_token_here
```

### Private Key Format
The `SOLANA_PRIVATE_KEY` must be in base58 format. You can get this from your Solana wallet or generate a new keypair.

### Network Issues
If you're having trouble connecting to MCP servers, make sure:
1. The server is running and accessible
2. The URL is correct
3. The server supports the ATXP protocol

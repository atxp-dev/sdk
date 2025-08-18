# ATXP Client Example

This is an example CLI application that demonstrates how to use the `atxp-client` library to interact with various MCP services using the ATXP payment system. It imports from the compiled JavaScript files in the main library's `dist` directory because the source files are designed to be compiled to CommonJS and use `.js` extensions in imports.

## Features

- Uses the `atxpClient` function to create a proper MCP client
- Handles OAuth authentication automatically
- Processes payments through ATXP when required
- Supports multiple MCP servers
- Configurable Solana account for payments

## Usage

1. Set up environment variables:
   - `SOLANA_ENDPOINT`: Your Solana RPC endpoint
   - `SOLANA_PRIVATE_KEY`: Your Solana private key

2. Run the example:
   ```bash
   npm run start [url] [toolName] [arg1=value1] [arg2=value2]
   ```

3. Uses the `atxpClient` function to create a proper MCP client

## Example

```bash
npm run start http://localhost:3009 secure-data message=hello
```

This will:
- Connect to the MCP server at `http://localhost:3009`
- Call the `secure-data` tool
- Pass `message=hello` as an argument

## Configuration

The example uses the following configuration:
- **Account**: `atxp`
- **Payment Network**: Solana
- **Currency**: USDC
- **Authorization Server**: `http://localhost:3010`

## Error Handling

The application includes comprehensive error handling for:
- Missing command line arguments
- Invalid service types
- Missing environment variables
- Network errors
- Payment failures
- Authentication errors

## Database

The application uses SQLite to store OAuth tokens and client credentials. The database file (`example-oauth.db`) is created in the current directory.

## Security Notes

- Never commit your private keys to version control
- Use environment variables for sensitive configuration
- The database file contains encrypted tokens - keep it secure
- Consider using a dedicated wallet for this application

## Troubleshooting

### Import Errors
If you encounter import errors like "The requested module does not provide an export", make sure:
1. The main library has been built: `cd .. && npm run build`
2. You're using the correct import paths (pointing to `dist/` directory)
3. The TypeScript compiler can resolve the imports correctly

**Note**: The example uses compiled JavaScript files from the `dist` directory because the source files are designed to be compiled to CommonJS and use `.js` extensions in their imports, which requires compilation for proper module resolution.

### Private Key Format
The `SOLANA_PRIVATE_KEY` must be in base58 format. You can get this from your Solana wallet or generate a new keypair.

 
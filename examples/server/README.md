# ATXP Server Example

This example demonstrates how to create an MCP (Model Context Protocol) server using the ATXP (Authorization Token Exchange Protocol) library with payment requirements.

## Features

- 🚀 **Simple MCP Server**: Implements a basic MCP server with one tool
- 💰 **Payment Integration**: Requires 0.01 USDC payment before executing the tool
- 🌐 **Multi-Network Support**: Supports Base, Ethereum, Solana and other networks
- 🔐 **ATXP Authentication**: Uses OAuth-based authentication flow
- 🛠️ **Hello World Tool**: Simple greeting tool that accepts optional parameters
- 🏥 **Health Check**: Basic health check endpoint

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```
   
   > **Note**: This example requires `better-sqlite3` for OAuth token storage. It's included as a dependency and will be installed automatically.

2. **Set up environment variables**:
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` and provide:
   - `FUNDING_DESTINATION`: Your wallet address to receive payments
   - `FUNDING_NETWORK`: Network for payments (e.g., 'base', 'ethereum', 'solana')
   - `PORT`: (Optional) Server port, defaults to 3010
   - `ATXP_SERVER`: (Optional) ATXP auth server, defaults to https://auth.atxp.ai

3. **Build the packages** (from repository root):
   ```bash
   npm run build
   ```

## Running the Server

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

### Direct Execution
```bash
./dev.sh
```

## Usage

The server exposes an MCP endpoint at `http://localhost:3010/` that accepts MCP protocol requests.

### Available Tools

#### `hello_world`
A simple greeting tool that requires a 0.01 USDC payment.

**Parameters:**
- `name` (optional): Name to include in greeting  
- `message` (optional): Custom message to append

**Example MCP Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "hello_world",
    "arguments": {
      "name": "Alice",
      "message": "Hope you're having a great day!"
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text", 
        "text": "Hello, Alice! Hope you're having a great day!"
      }
    ]
  }
}
```

### Testing with a Client

You can test this server using the basic client example:

1. Start the server:
   ```bash
   # Terminal 1 - Server
   cd examples/server
   npm run dev
   ```

2. Use a client to make requests:
   ```bash
   # Terminal 2 - Client (if you have an ATXP client)
   curl -X POST http://localhost:3010/ \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "tools/call", 
       "params": {
         "name": "hello_world",
         "arguments": {"name": "World"}
       }
     }'
   ```

### Health Check

Check if the server is running:
```bash
curl http://localhost:3010/health
```

## Authentication & Payment Flow

1. **Client Request**: Client sends MCP request to server
2. **Authentication Challenge**: Server responds with OAuth challenge if not authenticated
3. **Client Authentication**: Client follows OAuth flow to get access token
4. **Payment Required**: Server requires 0.01 USDC payment before executing tool
5. **Payment Processing**: Client makes payment on the configured network to server's destination address
6. **Tool Execution**: Server executes the tool and returns results

## Architecture

- **Express.js**: Web server framework
- **ATXP Express Middleware**: Handles authentication and payment validation
- **MCP Server**: Implements Model Context Protocol for tool calls
- **Zod**: Runtime type validation for tool parameters
- **BigNumber.js**: Precise decimal handling for payment amounts
- **SQLite (better-sqlite3)**: OAuth token storage and session management
- **Explicit OAuth Components**: Pre-built OAuthDb and OAuthResourceClient to ensure proper module resolution

## Error Handling

The server includes comprehensive error handling for:
- Missing environment variables
- Invalid MCP requests
- Payment failures
- Authentication failures
- Unexpected server errors

## Logs

The server provides detailed console logging showing:
- 🚀 Server startup and configuration
- 📨 Incoming MCP requests
- 💰 Payment requirements and confirmations
- ❌ Errors and debugging information
- 🔌 Connection lifecycle events
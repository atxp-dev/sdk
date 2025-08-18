# ATXP Client - Vercel AI SDK Example

This example demonstrates how to integrate the ATXP client with the Vercel AI SDK to create an AI-powered application that can automatically select and use MCP tools based on user requests.

## Features

- **AI-Powered Tool Selection**: Uses OpenAI to intelligently choose which MCP tools to use
- **Automatic OAuth & Payments**: Handles authentication and payments through ATXP
- **Streaming Responses**: Real-time streaming of AI responses and tool results
- **Multi-Tool Support**: Can use multiple MCP tools in a single conversation
- **Error Handling**: Graceful handling of tool failures and payment requirements

## Prerequisites

- Node.js 18 or higher
- A Solana wallet with USDC for payments
- OpenAI API key
- Access to MCP services

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables:
   ```bash
   export OPENAI_API_KEY="your_openai_api_key"
   export SOLANA_ENDPOINT="https://api.mainnet-beta.solana.com"
   export SOLANA_PRIVATE_KEY="your_base58_encoded_private_key"
   ```

3. Build the main library:
   ```bash
   cd ../..
   npm run build
   ```

## Usage

### Development mode:
```bash
npm run dev
```

### Production mode:
```bash
npm run build
npm start
```

## How it works

1. **User Input**: User sends a message to the AI
2. **Tool Selection**: OpenAI analyzes the request and determines which MCP tools to use
3. **Tool Execution**: The selected tools are executed with the appropriate parameters
4. **Payment Handling**: If payment is required, ATXP automatically processes it
5. **Response Generation**: Results are streamed back to the user

## Configuration

The application is configured with:
- **AI Model**: OpenAI GPT-4
- **Payment Network**: Solana
- **Currency**: USDC
- **Authorization Server**: ATXP

## Available Tools

- **Image Generation**: Create images from text descriptions
- **Search**: Search for information across various sources
- **File Operations**: Read and write files
- **Database Operations**: Query and modify databases

## Error Handling

- **Payment Required**: Automatically handles payment requirements
- **Tool Failures**: Gracefully handles tool execution failures
- **Authentication**: Manages OAuth authentication flows
- **Network Issues**: Retries failed requests with exponential backoff

## Architecture

```
User Request → OpenAI Analysis → Tool Selection → ATXP Client → MCP Tools → Response
```

## Development

### Adding New Tools

1. Update the tool selection prompt in `src/index.ts`
2. Add tool-specific handling logic
3. Update the MCP client configuration

### Customizing Payment Logic

- Modify the payment approval callback
- Add custom payment validation
- Implement payment analytics

## Troubleshooting

### Common Issues

1. **Payment Failures**: Ensure your Solana wallet has sufficient USDC
2. **Authentication Errors**: Check your OAuth configuration
3. **Tool Selection Issues**: Review the tool selection prompt

### Debug Mode

Enable debug output by setting the `DEBUG` environment variable:
```bash
DEBUG=1 npm run dev
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details

 
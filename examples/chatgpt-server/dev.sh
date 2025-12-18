#!/bin/bash
set -e

# Change to script directory
cd "$(dirname "$0")"

# Build packages if needed
echo "Building packages..."
cd ../..
npm run build
cd examples/chatgpt-server

# Run the server with tsx for TypeScript support
echo "Starting ChatGPT-compatible ATXP server..."
npx tsx src/index.ts

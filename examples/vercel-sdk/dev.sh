#!/bin/bash

# Build the main library first
cd ../.. && npm run build

# Go back to examples directory and run the development server
cd examples/vercel-sdk && npx tsx src/index.ts "$@" 

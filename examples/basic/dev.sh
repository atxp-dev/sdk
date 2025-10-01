#!/bin/bash

# Build the main library first (skip if SKIP_BUILD is set)
if [ -z "$SKIP_BUILD" ]; then
  cd ../.. && npm run build && cd examples/basic
fi

# Run the development server
npx tsx src/index.ts "$@" 

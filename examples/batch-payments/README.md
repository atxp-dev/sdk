# Batch Payments Example

MCP server demonstrating batch payment processing.

## Features

- Simple greeting tool with batch payment
- Middleware expects $0.05 total payment
- Tool requires $0.01 per batch

## Setup

This example is part of the ATXP SDK monorepo and should be run from the SDK root directory.

1. From the SDK root directory, install all dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cd examples/batch-payments
cp env.example .env
```

Edit `.env` with your ATXP connection string.

3. Run the server (from the examples/batch-payments directory):
```bash
npm run dev
```

Note: The dev script will automatically build the SDK packages before starting the server.

## Tool

### `batch_payment`

A personalized greeting that requires batch payment.

**Parameters:**
- `message`: (optional) Custom message to include in greeting

**Example:**
```json
{
  "message": "Thanks for using the batch payment system!"
}
```

## Payment Configuration

- Middleware expects: $0.05 total payment
- Tool requires: $0.01 per batch

## Running

```bash
npm run dev   # development
npm run build # build
npm start     # production
```
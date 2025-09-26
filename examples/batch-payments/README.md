# Batch Payments Example

MCP server demonstrating batch payment processing.

## Features

- Simple greeting tool with batch payment
- Middleware expects $0.05 total payment
- Tool requires $0.01 per batch

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp env.example .env
```

Edit `.env` with your ATXP connection string.

3. Run the server:
```bash
npm run dev
```

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
import { IncomingMessage } from "http";

// Helper function to parse size strings like "4mb" to bytes
function parseSize(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)\s*([kmgt]?b?)$/i);
  if (!match) {
    throw new Error(`Invalid size format: ${size}`);
  }

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'b').toLowerCase();

  const multipliers: Record<string, number> = {
    'b': 1,
    'kb': 1024,
    'mb': 1024 * 1024,
    'gb': 1024 * 1024 * 1024,
    'tb': 1024 * 1024 * 1024 * 1024,
  };

  return Math.floor(value * (multipliers[unit] || 1));
}

export async function getRawBody(req: IncomingMessage, encoding: string, maxSize: string): Promise<string> {
  // Use native Node.js approach to read request body
  const chunks: Buffer[] = [];
  let totalSize = 0;
  const maxSizeBytes = parseSize(maxSize);

  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > maxSizeBytes) {
      throw new Error(`Request body too large. Maximum size is ${maxSize}`);
    }
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks);
  return body.toString(encoding as BufferEncoding);
}
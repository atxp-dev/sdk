import { Hex } from 'viem';

export interface MemoCall {
  to: Hex;
  data: Hex;
  value: Hex;
}

/**
 * Creates a memo call for EVM transactions.
 * 
 * IMPORTANT: This is a custom approach for including memos in EVM transactions.
 * There is no standardized memo field in Ethereum-like transactions, unlike Bitcoin or Solana.
 * 
 * This implementation creates a call to the zero address (0x0...0) with the memo encoded
 * as hex data. This approach:
 * - Records the memo on-chain in the transaction's call data
 * - Is visible in block explorers and transaction traces
 * - Uses minimal gas (basic transaction cost to 0x0)
 * - Can be parsed by payment verification systems
 * 
 * Alternative approaches could include:
 * - Emitting a custom event from a memo contract
 * - Appending data to the main transfer call
 * - Using a dedicated memo storage contract
 * 
 * @param memo The memo string to include in the transaction
 * @returns A MemoCall object that can be included in a batch transaction, or null if memo is empty
 */
export function createMemoCall(memo: string): MemoCall | null {
  if (!memo || memo.trim().length === 0) {
    return null;
  }

  return {
    to: '0x0000000000000000000000000000000000000000' as Hex,
    data: ('0x' + Buffer.from(memo.trim(), 'utf8').toString('hex')) as Hex,
    value: '0x0' as Hex
  };
}

/**
 * Decodes memo data from a memo call's data field
 * @param data The hex-encoded data from a memo call
 * @returns The decoded memo string, or null if the data is invalid
 */
export function decodeMemoData(data: Hex): string | null {
  try {
    // Remove '0x' prefix and convert hex to buffer
    const hexString = data.startsWith('0x') ? data.slice(2) : data;
    if (hexString.length === 0 || hexString.length % 2 !== 0) {
      return null;
    }
    
    const buffer = Buffer.from(hexString, 'hex');
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}
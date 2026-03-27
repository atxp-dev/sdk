import { describe, it, expect } from 'vitest';
import { TempoAccount } from './tempoAccount.js';
import { TEMPO_MAINNET_CHAIN_ID, TEMPO_TESTNET_CHAIN_ID } from './tempoConstants.js';

// A valid private key for testing (do NOT use in production)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('TempoAccount', () => {
  it('creates account with correct accountId format (tempo:0x...)', () => {
    const account = new TempoAccount('https://rpc.tempo.xyz', TEST_PRIVATE_KEY);
    // accountId should be tempo:<address>
    return account.getAccountId().then(id => {
      expect(id).toMatch(/^tempo:0x[a-fA-F0-9]{40}$/);
    });
  });

  it('returns tempo chain in sources', async () => {
    const account = new TempoAccount('https://rpc.tempo.xyz', TEST_PRIVATE_KEY);
    const sources = await account.getSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].chain).toBe('tempo');
    expect(sources[0].walletType).toBe('eoa');
    expect(sources[0].address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('createSpendPermission returns null', async () => {
    const account = new TempoAccount('https://rpc.tempo.xyz', TEST_PRIVATE_KEY);
    const result = await account.createSpendPermission('https://example.com');
    expect(result).toBeNull();
  });

  it('uses mainnet chain by default', async () => {
    const account = new TempoAccount('https://rpc.tempo.xyz', TEST_PRIVATE_KEY);
    // Verify it was created successfully (mainnet is the default)
    const id = await account.getAccountId();
    expect(id).toMatch(/^tempo:0x/);
    expect(account.paymentMakers).toHaveLength(1);
  });

  it('can specify testnet chainId', async () => {
    const account = new TempoAccount('https://rpc.moderato.tempo.xyz', TEST_PRIVATE_KEY, TEMPO_TESTNET_CHAIN_ID);
    const id = await account.getAccountId();
    expect(id).toMatch(/^tempo_moderato:0x/);
    expect(account.paymentMakers).toHaveLength(1);
  });

  it('can specify mainnet chainId explicitly', async () => {
    const account = new TempoAccount('https://rpc.tempo.xyz', TEST_PRIVATE_KEY, TEMPO_MAINNET_CHAIN_ID);
    const id = await account.getAccountId();
    expect(id).toMatch(/^tempo:0x/);
  });

  it('throws when rpcUrl is empty', () => {
    expect(() => new TempoAccount('', TEST_PRIVATE_KEY)).toThrow('Tempo RPC URL is required');
  });

  it('throws when sourceSecretKey is empty', () => {
    expect(() => new TempoAccount('https://rpc.tempo.xyz', '')).toThrow('Source secret key is required');
  });

  it('provides access to local account signer', () => {
    const account = new TempoAccount('https://rpc.tempo.xyz', TEST_PRIVATE_KEY);
    const localAccount = account.getLocalAccount();
    expect(localAccount).toBeDefined();
    expect(localAccount.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});

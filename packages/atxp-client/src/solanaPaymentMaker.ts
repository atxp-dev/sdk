import type { PaymentMaker } from './types.js';
import { InsufficientFundsError, PaymentNetworkError } from './types.js';
import { Keypair, Connection, PublicKey, ComputeBudgetProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { createTransfer, ValidateTransferError as _ValidateTransferError } from "@solana/pay";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";
import BigNumber from "bignumber.js";
import { generateJWT, Currency, AccountId, PaymentIdentifier, Destination, Chain } from '@atxp/common';
import { importJWK } from 'jose';
import { Logger } from '@atxp/common';
import { ConsoleLogger } from '@atxp/common';

// this is a global public key for USDC on the solana mainnet
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

export const ValidateTransferError = _ValidateTransferError;

export class SolanaPaymentMaker implements PaymentMaker {
  private connection: Connection;
  private source: Keypair;
  private logger: Logger;

  constructor(solanaEndpoint: string, sourceSecretKey: string, logger?: Logger) {
    if (!solanaEndpoint) {
      throw new Error('Solana endpoint is required');
    }
    if (!sourceSecretKey) {
      throw new Error('Source secret key is required');
    }
    this.connection = new Connection(solanaEndpoint, { commitment: 'confirmed' });
    this.source = Keypair.fromSecretKey(bs58.decode(sourceSecretKey));
    this.logger = logger ?? new ConsoleLogger();
  }

  getSourceAddress(_params: {amount: BigNumber, currency: Currency, receiver: string, memo: string}): string {
    return this.source.publicKey.toBase58();
  }

  generateJWT = async({paymentRequestId, codeChallenge, accountId}: {paymentRequestId: string, codeChallenge: string, accountId?: AccountId | null}): Promise<string> => {
    // Solana/Web3.js secretKey is 64 bytes:
    // first 32 bytes are the private scalar, last 32 are the public key.
    // JWK expects only the 32-byte private scalar for 'd'
    const jwk = {
      kty: 'OKP',
      crv: 'Ed25519',
      d: Buffer.from(this.source.secretKey.slice(0, 32)).toString('base64url'),
      x: Buffer.from(this.source.publicKey.toBytes()).toString('base64url'),
    };
    const privateKey = await importJWK(jwk, 'EdDSA');
    if (!(privateKey instanceof CryptoKey)) {
      throw new Error('Expected CryptoKey from importJWK');
    }
    return generateJWT(this.source.publicKey.toBase58(), privateKey, paymentRequestId || '', codeChallenge || '', accountId as AccountId | undefined);
  }

  makePayment = async (destinations: Destination[], memo: string, _paymentRequestId?: string): Promise<PaymentIdentifiers | null> => {
    // Filter to solana chain destinations
    const solanaDestinations = destinations.filter(d => d.chain === 'solana');

    if (solanaDestinations.length === 0) {
      this.logger.debug('SolanaPaymentMaker: No solana destinations found, cannot handle payment');
      return null; // Cannot handle these destinations
    }

    // Pick first solana destination
    const dest = solanaDestinations[0];
    const amount = dest.amount;
    const currency = dest.currency;
    const receiver = dest.address;

    if (currency.toUpperCase() !== 'USDC') {
      throw new PaymentNetworkError('Only USDC currency is supported; received ' + currency);
    }

    const receiverKey = new PublicKey(receiver);

    this.logger.info(`Making payment of ${amount} ${currency} to ${receiver} on Solana from ${this.source.publicKey.toBase58()}`);

    try {
      // Check balance before attempting payment
      const tokenAccountAddress = await getAssociatedTokenAddress(
        USDC_MINT,
        this.source.publicKey
      );

      const tokenAccount = await getAccount(this.connection, tokenAccountAddress);
      const balance = new BigNumber(tokenAccount.amount.toString()).dividedBy(10 ** 6); // USDC has 6 decimals

      if (balance.lt(amount)) {
        this.logger.warn(`Insufficient ${currency} balance for payment. Required: ${amount}, Available: ${balance}`);
        throw new InsufficientFundsError(currency, amount, balance, 'solana');
      }

      // Get the destination token account address (this will be the transactionId)
      const destinationTokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        receiverKey
      );

      // Increase compute units to handle both memo and token transfer
      // Memo uses ~6000 CUs, token transfer needs ~6500 CUs
      const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
        units: 50000,
      });

      const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 20000,
      });

      const transaction = await createTransfer(
        this.connection,
        this.source.publicKey,
        {
          amount: amount,
          recipient: receiverKey,
          splToken: USDC_MINT,
          memo,
        }
      );

      transaction.add(modifyComputeUnits);
      transaction.add(addPriorityFee);

      const transactionSignature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.source],
      );

      // Return transaction signature as transactionId and token account address as transactionSubId
      return {
        transactionId: transactionSignature,
        transactionSubId: destinationTokenAccount.toBase58(),
        chain: 'solana',
        currency: 'USDC'
      };
    } catch (error) {
      if (error instanceof InsufficientFundsError || error instanceof PaymentNetworkError) {
        throw error;
      }

      // Wrap other errors in PaymentNetworkError
      throw new PaymentNetworkError(`Payment failed on Solana network: ${(error as Error).message}`, error as Error);
    }
  }
}
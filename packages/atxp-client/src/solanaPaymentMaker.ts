import type { PaymentMaker, SignedPaymentMessage } from './types.js';
import { InsufficientFundsError, PaymentNetworkError } from './types.js';
import { Keypair, Connection, PublicKey, ComputeBudgetProgram, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { createTransfer, ValidateTransferError as _ValidateTransferError } from "@solana/pay";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";
import BigNumber from "bignumber.js";
import { generateJWT, Currency, Network, Logger, ConsoleLogger } from '@atxp/common';
import { importJWK } from 'jose';

// this is a global public key for USDC on the solana mainnet
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

export const ValidateTransferError = _ValidateTransferError;

export class SolanaPaymentMaker implements PaymentMaker {
  private connection: Connection;
  private source: Keypair;
  private logger: Logger;
  private lastSignedTransaction: string | null = null;

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

  generateJWT = async({paymentRequestId, codeChallenge}: {paymentRequestId: string, codeChallenge: string}): Promise<string> => {
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
    return generateJWT(this.source.publicKey.toBase58(), privateKey, paymentRequestId || '', codeChallenge || '');
  }

  async createSignedPaymentMessage(amount: BigNumber, currency: Currency, receiver: string, memo: string): Promise<SignedPaymentMessage> {
    if (currency.toUpperCase() !== 'USDC') {
      throw new PaymentNetworkError('Only USDC currency is supported; received ' + currency);
    }

    const receiverKey = new PublicKey(receiver);
    this.logger.info(`Creating signed payment message for ${amount} ${currency} to ${receiver} on Solana from ${this.source.publicKey.toBase58()}`);

    try {
      // Check balance before creating payment message
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

      const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
        units: 10000,
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

      // Sign the transaction
      transaction.sign(this.source);

      // Serialize the signed transaction
      const signedTx = bs58.encode(transaction.serialize());

      // Store for potential later submission
      this.lastSignedTransaction = signedTx;

      return {
        data: bs58.encode(transaction.serialize({ requireAllSignatures: false })),
        signature: signedTx, // The actual signed transaction
        from: this.source.publicKey.toBase58(),
        to: receiver,
        amount: amount,
        currency: currency,
        network: 'solana' as Network
      };
    } catch (error) {
      if (error instanceof InsufficientFundsError || error instanceof PaymentNetworkError) {
        throw error;
      }

      // Wrap other errors in PaymentNetworkError
      throw new PaymentNetworkError(`Failed to create signed payment message: ${(error as Error).message}`, error as Error);
    }
  }

  async submitPaymentMessage(signedMessage: SignedPaymentMessage): Promise<string> {
    this.logger.info(`Submitting payment to Solana blockchain`);

    try {
      // Use the signed transaction from the message or the stored one
      const signedTx = signedMessage.signature || this.lastSignedTransaction;

      if (!signedTx) {
        throw new PaymentNetworkError('No signed transaction available');
      }

      // Deserialize and send the signed transaction
      const transaction = Transaction.from(bs58.decode(signedTx));

      const transactionHash = await this.connection.sendRawTransaction(
        transaction.serialize()
      );

      // Wait for confirmation
      await this.connection.confirmTransaction(transactionHash, 'confirmed');

      // Clear the stored transaction
      this.lastSignedTransaction = null;

      return transactionHash;
    } catch (error) {
      if (error instanceof PaymentNetworkError) {
        throw error;
      }

      // Wrap other errors in PaymentNetworkError
      throw new PaymentNetworkError(`Failed to submit payment: ${(error as Error).message}`, error as Error);
    }
  }
}
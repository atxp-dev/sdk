import express from 'express';
import cors from 'cors';
import { BigNumber } from 'bignumber.js';
import { Network, Currency } from '@atxp/common';
import type { SignedPaymentMessage } from '@atxp/client';

const app = express();
app.use(cors());
app.use(express.json());

// Mock facilitator for demonstration
// In production, this would be replaced with an actual X402 facilitator
class MockX402Facilitator {
  private processedPayments = new Map<string, boolean>();

  async verify(paymentMessage: SignedPaymentMessage): Promise<boolean> {
    // Mock verification - in production this would:
    // 1. Verify the signature
    // 2. Check account balance
    // 3. Verify the payment details match what was requested
    console.log('Facilitator: Verifying payment message:', {
      from: paymentMessage.from,
      to: paymentMessage.to,
      amount: paymentMessage.amount.toString(),
      currency: paymentMessage.currency,
      network: paymentMessage.network
    });

    // Simple mock validation
    if (!paymentMessage.signature || !paymentMessage.data) {
      console.log('Facilitator: Invalid payment message - missing signature or data');
      return false;
    }

    // Check if payment amount is sufficient (mock check)
    const requiredAmount = new BigNumber('1'); // 1 USDC
    if (paymentMessage.amount.lt(requiredAmount)) {
      console.log(`Facilitator: Insufficient payment amount. Required: ${requiredAmount}, Got: ${paymentMessage.amount}`);
      return false;
    }

    return true;
  }

  async settle(paymentMessage: SignedPaymentMessage): Promise<string> {
    // Mock settlement - in production this would submit to blockchain
    console.log('Facilitator: Settling payment on blockchain...');

    // Generate a mock transaction hash
    const mockTxHash = '0x' + Math.random().toString(16).substring(2, 66);

    // Mark as processed to prevent replay
    this.processedPayments.set(paymentMessage.signature, true);

    console.log(`Facilitator: Payment settled with tx hash: ${mockTxHash}`);
    return mockTxHash;
  }

  isPaymentProcessed(signature: string): boolean {
    return this.processedPayments.has(signature);
  }
}

const facilitator = new MockX402Facilitator();

// Protected resource that requires payment
interface ResourceData {
  data: string;
  timestamp: number;
}

// Store for accessed resources (in production, this would be a database)
const accessedResources = new Map<string, Set<string>>();

// Example protected endpoint
app.get('/protected-resource/:id', async (req, res) => {
  const resourceId = req.params.id;
  const paymentHeader = req.headers['x-payment'] as string | undefined;

  console.log(`\n=== Request for resource: ${resourceId} ===`);

  // Check if payment was provided
  if (!paymentHeader) {
    console.log('No payment provided, sending 402 challenge');

    // Send X402 payment challenge
    const paymentChallenge = {
      network: 'base' as Network,
      currency: 'USDC' as Currency,
      amount: '1', // 1 USDC
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8', // Example recipient address
      memo: `Payment for resource ${resourceId}`
    };

    res.status(402)
      .header('X-Payment', JSON.stringify(paymentChallenge))
      .json({
        error: 'Payment Required',
        message: 'This resource requires payment to access',
        payment: paymentChallenge
      });
    return;
  }

  try {
    // Parse the payment message from header
    console.log('Payment header received:', paymentHeader);
    const paymentMessage: SignedPaymentMessage = JSON.parse(paymentHeader);

    // Check if this payment was already processed
    if (facilitator.isPaymentProcessed(paymentMessage.signature)) {
      console.log('Payment already processed (replay attempt)');
      res.status(400).json({
        error: 'Payment already processed',
        message: 'This payment signature has already been used'
      });
      return;
    }

    // Verify the payment with facilitator
    const isValid = await facilitator.verify(paymentMessage);

    if (!isValid) {
      console.log('Payment verification failed');
      res.status(400).json({
        error: 'Invalid payment',
        message: 'The payment could not be verified'
      });
      return;
    }

    // Settle the payment
    const txHash = await facilitator.settle(paymentMessage);

    // Grant access to the resource
    const userAddress = paymentMessage.from;
    if (!accessedResources.has(userAddress)) {
      accessedResources.set(userAddress, new Set());
    }
    accessedResources.get(userAddress)!.add(resourceId);

    console.log(`Access granted to ${userAddress} for resource ${resourceId}`);

    // Return the protected resource
    const resource: ResourceData = {
      data: `This is protected content for resource ${resourceId}. Thank you for your payment!`,
      timestamp: Date.now()
    };

    res.json({
      success: true,
      transactionHash: txHash,
      resource
    });

  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({
      error: 'Payment processing failed',
      message: (error as Error).message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', facilitator: 'mock' });
});

// List accessed resources for a user
app.get('/user/:address/resources', (req, res) => {
  const userAddress = req.params.address;
  const resources = accessedResources.get(userAddress);

  res.json({
    address: userAddress,
    resources: resources ? Array.from(resources) : []
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`X402 Example Server running on http://localhost:${PORT}`);
  console.log('\nAvailable endpoints:');
  console.log(`  GET /protected-resource/:id - Protected resource requiring X402 payment`);
  console.log(`  GET /health - Health check`);
  console.log(`  GET /user/:address/resources - List resources accessed by a user`);
  console.log('\nPayment details:');
  console.log('  Network: Base');
  console.log('  Currency: USDC');
  console.log('  Amount: 1 USDC per resource');
  console.log('\nNote: This is a mock implementation for demonstration purposes.');
  console.log('In production, use a real X402 facilitator for payment verification and settlement.');
});
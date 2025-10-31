import React, { useState, useEffect, useCallback } from 'react';
import { PolygonBrowserAccount } from '../../src/polygonBrowserAccount';
import { atxpClient } from '@atxp/client';
import type { Account } from '@atxp/common';

/**
 * Test component for ATXP Polygon browser integration
 *
 * This component demonstrates:
 * - Wallet connection
 * - Smart Wallet vs Direct Wallet modes
 * - Account initialization
 * - ATXP client integration
 * - Image generation with payments
 * - Error handling
 * - Cache management
 *
 * Usage:
 * import { PolygonTestComponent } from './PolygonTestComponent';
 *
 * function App() {
 *   return <PolygonTestComponent />;
 * }
 */

interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'info' | 'error' | 'success' | 'warning';
}

type WalletMode = 'smart' | 'direct';

interface AccountInfo {
  accountId: string;
  sources: Array<{
    address: string;
    chain: string;
    walletType: string;
  }>;
  paymentMakersCount: number;
}

interface GeneratedImage {
  url: string;
  prompt: string;
  timestamp: Date;
}

export const PolygonTestComponent: React.FC = () => {
  // State
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [client, setClient] = useState<any>(null);
  const [mode, setMode] = useState<WalletMode>('smart');
  const [chainId, setChainId] = useState<number>(80002); // Default to Amoy testnet
  const [allowance, setAllowance] = useState<string>('10');
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Image generation state
  const [imagePrompt, setImagePrompt] = useState<string>('A cat riding a horse');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);

  // Logging helper
  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogs((prev) => [...prev, { timestamp: new Date(), message, type }]);
  }, []);

  // Clear logs
  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // Connect wallet
  const connectWallet = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      addLog('Checking for wallet provider...', 'info');

      if (!window.ethereum) {
        throw new Error('No wallet provider found. Please install MetaMask or Coinbase Wallet.');
      }

      addLog('Requesting wallet connection...', 'info');
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      }) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found');
      }

      setWalletAddress(accounts[0]);
      addLog(`Connected to wallet: ${accounts[0]}`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addLog(`Connection error: ${message}`, 'error');
      setError(message);
    } finally {
      setIsConnecting(false);
    }
  }, [addLog]);

  // Disconnect wallet
  const disconnectWallet = useCallback(() => {
    setWalletAddress(null);
    setAccount(null);
    setClient(null);
    setAccountInfo(null);
    setGeneratedImages([]);
    addLog('Wallet disconnected', 'info');
  }, [addLog]);

  // Initialize account
  const initializeAccount = useCallback(async () => {
    if (!walletAddress) {
      setError('Please connect wallet first');
      return;
    }

    setIsInitializing(true);
    setError(null);

    try {
      const useEphemeralWallet = mode === 'smart';
      const allowanceBigInt = BigInt(Math.floor(parseFloat(allowance) * 1_000_000));

      addLog('Initializing account...', 'info');
      addLog(`- Mode: ${useEphemeralWallet ? 'Smart Wallet (gasless)' : 'Direct Wallet'}`, 'info');
      addLog(`- Chain ID: ${chainId}`, 'info');
      addLog(`- Allowance: ${allowance} USDC`, 'info');
      addLog(`- Period: ${periodDays} days`, 'info');
      if (!window.ethereum) {
        throw new Error('No wallet provider found. Please install MetaMask or Coinbase Wallet.');
      }

      const polygonAccount = await PolygonBrowserAccount.initialize({
        provider: window.ethereum,
        walletAddress,
        useEphemeralWallet,
        allowance: allowanceBigInt,
        periodInDays: periodDays,
        chainId,
        logger: {
          info: (msg: string) => addLog(`[INFO] ${msg}`, 'info'),
          warn: (msg: string) => addLog(`[WARN] ${msg}`, 'warning'),
          error: (msg: string) => addLog(`[ERROR] ${msg}`, 'error'),
          debug: (msg: string) => addLog(`[DEBUG] ${msg}`, 'info'),
        },
      });

      setAccount(polygonAccount);
      addLog('Account initialized successfully!', 'success');

      // Initialize ATXP client
      addLog('Initializing ATXP client...', 'info');
      const atxpClientInstance = await atxpClient({
        account: polygonAccount,
        mcpServer: 'https://image.mcp.atxp.ai/',
        onPayment: async ({ payment }) => {
          addLog(`Payment successful: ${JSON.stringify(payment)}`, 'success');
          console.log('Payment details:', payment);
        },
        onPaymentFailure: async ({ payment, error }) => {
          addLog(`Payment failed: ${error.message}`, 'error');
          console.error('Payment error:', payment, error);
        },
      });

      setClient(atxpClientInstance);
      addLog('ATXP client initialized successfully!', 'success');

      // Load account info
      await loadAccountInfo(polygonAccount);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addLog(`Initialization error: ${message}`, 'error');
      setError(message);
      console.error('Full error:', err);
    } finally {
      setIsInitializing(false);
    }
  }, [walletAddress, mode, chainId, allowance, periodDays, addLog]);

  // Load account info
  const loadAccountInfo = useCallback(async (acc: Account | null = account) => {
    if (!acc) return;

    try {
      const sources = await acc.getSources();
      const info: AccountInfo = {
        accountId: acc.accountId,
        sources,
        paymentMakersCount: acc.paymentMakers.length,
      };
      setAccountInfo(info);
      addLog('Account info loaded', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addLog(`Error loading account info: ${message}`, 'error');
    }
  }, [account, addLog]);

  // Generate image with async polling
  const generateImage = useCallback(async () => {
    if (!client) {
      setError('Client not initialized');
      return;
    }

    if (!imagePrompt.trim()) {
      setError('Please enter an image prompt');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      addLog(`Generating image: "${imagePrompt}"`, 'info');
      addLog('Calling image_create_image_async...', 'info');

      // Start async image generation
      const createResult = await client.callTool({
        name: 'image_create_image_async',
        arguments: { prompt: imagePrompt },
      });

      addLog('Image generation started', 'success');
      console.log('Create result:', createResult);

      // Extract task ID from result
      const taskId = createResult?.content?.[0]?.text || createResult?.taskId;
      if (!taskId) {
        throw new Error('No task ID returned from image generation');
      }

      addLog(`Task ID: ${taskId}`, 'info');
      addLog('Polling for completion...', 'info');

      // Poll for completion
      let attempts = 0;
      const maxAttempts = 30; // 30 attempts with 2 second intervals = 1 minute max
      const pollInterval = 2000; // 2 seconds

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        attempts++;

        addLog(`Checking status (attempt ${attempts}/${maxAttempts})...`, 'info');

        const statusResult = await client.callTool({
          name: 'image_get_image_async',
          arguments: { task_id: taskId },
        });

        console.log('Status result:', statusResult);

        const status = statusResult?.content?.[0]?.text || statusResult?.status;

        if (typeof status === 'string' && status.includes('completed')) {
          // Extract image URL from result
          const urlMatch = status.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            const imageUrl = urlMatch[0];
            addLog('Image generated successfully!', 'success');

            setGeneratedImages(prev => [{
              url: imageUrl,
              prompt: imagePrompt,
              timestamp: new Date(),
            }, ...prev]);

            return;
          }
        } else if (typeof status === 'string' && status.includes('failed')) {
          throw new Error('Image generation failed');
        }
      }

      throw new Error('Image generation timed out');

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addLog(`Image generation error: ${message}`, 'error');
      setError(message);
      console.error('Full error:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [client, imagePrompt, addLog]);

  // Clear cache
  const clearCache = useCallback(() => {
    try {
      if (!walletAddress) {
        throw new Error('No wallet address');
      }

      PolygonBrowserAccount.clearAllCachedData(walletAddress);
      addLog('Cache cleared successfully', 'success');
      setAccount(null);
      setClient(null);
      setAccountInfo(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addLog(`Error clearing cache: ${message}`, 'error');
    }
  }, [walletAddress, addLog]);

  // Check if wallet is already connected on mount
  useEffect(() => {
    if (window.ethereum?.selectedAddress) {
      setWalletAddress(window.ethereum.selectedAddress);
      addLog(`Wallet already connected: ${window.ethereum.selectedAddress}`, 'info');
    }
  }, [addLog]);

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>ATXP Polygon Browser Test</h1>
      <p style={styles.subtitle}>Test browser integration with payments and image generation</p>

      {/* Wallet Connection Section */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>1. Wallet Connection</h2>
        {!walletAddress ? (
          <button
            onClick={connectWallet}
            disabled={isConnecting}
            style={styles.button}
          >
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        ) : (
          <div>
            <div style={styles.infoBox}>
              Connected: {walletAddress}
            </div>
            <button onClick={disconnectWallet} style={{ ...styles.button, ...styles.secondaryButton }}>
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Configuration Section */}
      {walletAddress && !account && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>2. Configure Account</h2>

          {/* Mode Selection */}
          <div style={styles.modeSelector}>
            <div
              style={{
                ...styles.modeOption,
                ...(mode === 'smart' ? styles.modeOptionSelected : {}),
              }}
              onClick={() => setMode('smart')}
            >
              <h3 style={styles.modeTitle}>Smart Wallet Mode</h3>
              <p style={styles.modeDesc}>Gasless transactions with single approval</p>
            </div>
            <div
              style={{
                ...styles.modeOption,
                ...(mode === 'direct' ? styles.modeOptionSelected : {}),
              }}
              onClick={() => setMode('direct')}
            >
              <h3 style={styles.modeTitle}>Direct Wallet Mode</h3>
              <p style={styles.modeDesc}>User signs each transaction</p>
            </div>
          </div>

          {/* Chain Selection */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Network:</label>
            <select
              value={chainId}
              onChange={(e) => setChainId(parseInt(e.target.value))}
              style={styles.select}
            >
              <option value="137">Polygon Mainnet (137)</option>
              <option value="80002">Polygon Amoy Testnet (80002)</option>
            </select>
          </div>

          {/* Allowance */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Allowance (USDC):</label>
            <input
              type="number"
              value={allowance}
              onChange={(e) => setAllowance(e.target.value)}
              step="0.01"
              min="0"
              style={styles.input}
            />
          </div>

          {/* Period */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Period (days):</label>
            <input
              type="number"
              value={periodDays}
              onChange={(e) => setPeriodDays(parseInt(e.target.value))}
              min="1"
              style={styles.input}
            />
          </div>

          <button
            onClick={initializeAccount}
            disabled={isInitializing}
            style={styles.button}
          >
            {isInitializing ? 'Initializing...' : 'Initialize Account'}
          </button>
        </div>
      )}

      {/* Account Info Section */}
      {account && accountInfo && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>3. Account Information</h2>
          <div style={styles.accountInfo}>
            <div><strong>Account ID:</strong> {accountInfo.accountId}</div>
            <div><strong>Mode:</strong> {mode === 'smart' ? 'Smart Wallet' : 'Direct Wallet'}</div>
            <div><strong>Payment Makers:</strong> {accountInfo.paymentMakersCount}</div>
            <div style={{ marginTop: '10px' }}>
              <strong>Sources:</strong>
              {accountInfo.sources.map((source, idx) => (
                <div key={idx} style={{ marginLeft: '20px', marginTop: '5px' }}>
                  <div>Address: {source.address}</div>
                  <div>Chain: {source.chain}</div>
                  <div>Type: {source.walletType}</div>
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => loadAccountInfo()} style={styles.button}>
            Refresh Info
          </button>
          <button onClick={clearCache} style={{ ...styles.button, ...styles.secondaryButton }}>
            Clear Cache
          </button>
        </div>
      )}

      {/* Image Generation Section */}
      {client && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>4. Generate Image with Payment</h2>
          <p style={{ marginBottom: '15px', fontSize: '14px', color: '#666' }}>
            Each image generation costs approximately $0.05 USDC
          </p>

          <div style={styles.formGroup}>
            <label style={styles.label}>Image Prompt:</label>
            <input
              type="text"
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder="e.g., A cat riding a horse"
              style={styles.input}
              disabled={isGenerating}
            />
          </div>

          <button
            onClick={generateImage}
            disabled={isGenerating || !imagePrompt.trim()}
            style={styles.button}
          >
            {isGenerating ? 'Generating...' : 'Generate Image'}
          </button>

          {/* Generated Images */}
          {generatedImages.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <h3 style={{ fontSize: '16px', marginBottom: '10px' }}>Generated Images:</h3>
              {generatedImages.map((img, idx) => (
                <div key={idx} style={styles.imageCard}>
                  <img src={img.url} alt={img.prompt} style={styles.image} />
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>Prompt:</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>{img.prompt}</div>
                    <div style={{ fontSize: '11px', color: '#999', marginTop: '5px' }}>
                      {img.timestamp.toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div style={styles.errorBox}>
          Error: {error}
        </div>
      )}

      {/* Console Log */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Console Log</h2>
        <button onClick={clearLogs} style={{ ...styles.button, ...styles.secondaryButton }}>
          Clear Log
        </button>
        <div style={styles.logContainer}>
          {logs.map((log, idx) => (
            <div key={idx} style={styles.logEntry}>
              <span style={{ color: getLogColor(log.type) }}>
                [{log.timestamp.toLocaleTimeString()}] {log.message}
              </span>
            </div>
          ))}
          {logs.length === 0 && (
            <div style={{ color: '#999' }}>No logs yet...</div>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper function for log colors
function getLogColor(type: LogEntry['type']): string {
  switch (type) {
    case 'error':
      return '#d32f2f';
    case 'success':
      return '#388e3c';
    case 'warning':
      return '#f57c00';
    default:
      return '#333';
  }
}

// Styles
const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: '900px',
    margin: '50px auto',
    padding: '20px',
  },
  title: {
    color: '#333',
    marginBottom: '10px',
  },
  subtitle: {
    color: '#666',
    marginBottom: '30px',
  },
  section: {
    marginBottom: '30px',
    padding: '20px',
    background: '#f9f9f9',
    borderRadius: '4px',
  },
  sectionTitle: {
    marginTop: '0',
    color: '#444',
    fontSize: '18px',
  },
  button: {
    background: '#0052ff',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500' as const,
    marginRight: '10px',
    marginBottom: '10px',
  },
  secondaryButton: {
    background: '#6c757d',
  },
  infoBox: {
    padding: '10px',
    background: '#d1ecf1',
    color: '#0c5460',
    borderRadius: '4px',
    marginBottom: '10px',
    fontSize: '14px',
  },
  errorBox: {
    padding: '10px',
    background: '#f8d7da',
    color: '#721c24',
    borderRadius: '4px',
    marginBottom: '20px',
    fontSize: '14px',
  },
  modeSelector: {
    display: 'flex',
    gap: '10px',
    margin: '15px 0',
  },
  modeOption: {
    flex: '1',
    padding: '15px',
    border: '2px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    textAlign: 'center' as const,
    transition: 'all 0.2s',
  },
  modeOptionSelected: {
    borderColor: '#0052ff',
    background: '#e7f1ff',
  },
  modeTitle: {
    margin: '0 0 5px 0',
    fontSize: '16px',
  },
  modeDesc: {
    margin: '0',
    fontSize: '12px',
    color: '#666',
  },
  formGroup: {
    margin: '15px 0',
  },
  label: {
    display: 'block',
    marginBottom: '5px',
    fontWeight: '500' as const,
    color: '#555',
  },
  input: {
    width: '100%',
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    boxSizing: 'border-box' as const,
  },
  select: {
    width: '100%',
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    boxSizing: 'border-box' as const,
  },
  accountInfo: {
    background: '#f8f9fa',
    padding: '15px',
    borderRadius: '4px',
    fontSize: '14px',
    marginBottom: '15px',
    fontFamily: 'Monaco, "Courier New", monospace',
  },
  imageCard: {
    background: '#fff',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '15px',
    marginBottom: '15px',
  },
  image: {
    width: '100%',
    maxWidth: '512px',
    height: 'auto',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  logContainer: {
    background: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '4px',
    padding: '15px',
    marginTop: '15px',
    maxHeight: '300px',
    overflowY: 'auto' as const,
    fontFamily: 'Monaco, "Courier New", monospace',
    fontSize: '12px',
  },
  logEntry: {
    margin: '5px 0',
    padding: '2px 0',
    borderBottom: '1px solid #e9ecef',
  },
};

// Type augmentation for window.ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      selectedAddress?: string;
    };
  }
}

import chalk from 'chalk';
import open from 'open';
import { createServer } from 'http';

export async function runDemo(): Promise<void> {
  try {
    console.log(chalk.blue('🚀 Starting ATXP demo server...'));
    
    // Create demo server
    const demoServer = createDemoServer();
    
    // Start the server
    const server = demoServer.listen(3000, () => {
      console.log(chalk.green('✅ Demo server running at http://localhost:3000'));
      console.log(chalk.blue('🌐 Opening browser...'));
      
      // Open browser
      open('http://localhost:3000').catch(() => {
        console.log(chalk.yellow('⚠️  Could not open browser automatically'));
        console.log(chalk.white('   Please open http://localhost:3000 in your browser'));
      });
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n🛑 Shutting down demo server...'));
      server.close(() => {
        console.log(chalk.green('✅ Demo server stopped'));
        process.exit(0);
      });
    });

  } catch (error) {
    console.error(chalk.red('❌ Error starting demo:'), (error as Error).message);
    process.exit(1);
  }
}

function createDemoServer() {
  return createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ATXP Demo</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            line-height: 1.6;
            color: #333;
        }
        .header {
            text-align: center;
            margin-bottom: 3rem;
        }
        .demo-section {
            background: #f8f9fa;
            padding: 2rem;
            border-radius: 8px;
            margin-bottom: 2rem;
        }
        .code {
            background: #2d3748;
            color: #e2e8f0;
            padding: 1rem;
            border-radius: 4px;
            font-family: 'Monaco', 'Menlo', monospace;
            overflow-x: auto;
        }
        .button {
            background: #4299e1;
            color: white;
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 1rem;
            margin: 0.5rem 0.5rem 0.5rem 0;
        }
        .button:hover {
            background: #3182ce;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 ATXP Demo</h1>
        <p>Welcome to the ATXP (Authorization Token Exchange Protocol) demo!</p>
    </div>

    <div class="demo-section">
        <h2>What is ATXP?</h2>
        <p>ATXP is a framework for building and running agents that can interact with the world through secure OAuth authentication and Solana payments.</p>
    </div>

    <div class="demo-section">
        <h2>Quick Start</h2>
        <p>Create a new ATXP project:</p>
        <div class="code">npm create atxp</div>
        
        <p>Or run this demo:</p>
        <div class="code">npx atxp</div>
    </div>

    <div class="demo-section">
        <h2>Features</h2>
        <ul>
            <li>🔐 OAuth-based authentication</li>
            <li>💰 Solana payment integration</li>
            <li>🤖 MCP (Model Context Protocol) support</li>
            <li>⚡ Fast and secure</li>
            <li>🛠️ Easy to integrate</li>
        </ul>
    </div>

    <div class="demo-section">
        <h2>Try It Out</h2>
        <p>This is a minimal demo. The full demo will include interactive examples!</p>
        <button class="button" onclick="alert('Full demo coming soon!')">Interactive Demo</button>
        <button class="button" onclick="window.open('https://github.com/atxp-dev/sdk', '_blank')">View on GitHub</button>
    </div>

    <div class="demo-section">
        <h2>Documentation</h2>
        <p>For more information, visit <a href="https://docs.atxp.ai" target="_blank">docs.atxp.ai</a></p>
    </div>
</body>
</html>`;
    
    res.end(html);
  });
}

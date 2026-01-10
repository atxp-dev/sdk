/* eslint-disable no-console */
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { BigNumber } from 'bignumber.js';
import { atxpExpress, atxpAccountId, requirePayment } from '@atxp/express';
import { ConsoleLogger, LogLevel, AccountIdDestination } from '@atxp/common';
import { ATXPAccount } from '@atxp/client';
import 'dotenv/config';

const PORT = parseInt(process.env.PORT || '3009', 10);

// MCP Apps UI resource key (from @modelcontextprotocol/ext-apps)
const RESOURCE_URI_META_KEY = 'ui/resourceUri';

// Tic-Tac-Toe game state (persisted across requests via closure)
type Player = 'X' | 'O' | '';
type Board = Player[];
type GameState = {
  board: Board;
  currentPlayer: 'X' | 'O';
  winner: Player | 'draw' | null;
  gameOver: boolean;
  winningLine: number[] | null;
};

// Game state stored per-user (in production, use a proper store)
const gameStates = new Map<string, GameState>();

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

function createInitialState(): GameState {
  return {
    board: ['', '', '', '', '', '', '', '', ''],
    currentPlayer: 'X',
    winner: null,
    gameOver: false,
    winningLine: null,
  };
}

function checkWinner(board: Board): { winner: Player | 'draw' | null; winningLine: number[] | null } {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], winningLine: line };
    }
  }
  if (board.every(cell => cell !== '')) {
    return { winner: 'draw', winningLine: null };
  }
  return { winner: null, winningLine: null };
}

function makeAIMove(board: Board): number {
  // Simple AI: try to win, block, or pick random
  const opponent = 'X';
  const ai = 'O';

  // Try to win
  for (const line of WINNING_LINES) {
    const cells = line.map(i => board[i]);
    if (cells.filter(c => c === ai).length === 2 && cells.includes('')) {
      return line[cells.indexOf('')];
    }
  }

  // Block opponent
  for (const line of WINNING_LINES) {
    const cells = line.map(i => board[i]);
    if (cells.filter(c => c === opponent).length === 2 && cells.includes('')) {
      return line[cells.indexOf('')];
    }
  }

  // Take center if available
  if (board[4] === '') return 4;

  // Take a corner
  const corners = [0, 2, 6, 8];
  const availableCorners = corners.filter(i => board[i] === '');
  if (availableCorners.length > 0) {
    return availableCorners[Math.floor(Math.random() * availableCorners.length)];
  }

  // Take any available
  const available = board.map((cell, i) => cell === '' ? i : -1).filter(i => i !== -1);
  return available[Math.floor(Math.random() * available.length)];
}

// Interactive Tic-Tac-Toe UI HTML
const TICTACTOE_UI_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      height: 1000px;
      overflow: hidden;
    }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      box-sizing: border-box;
    }
    h2 {
      margin: 0 0 16px 0;
      font-size: 24px;
      text-shadow: 0 2px 10px rgba(0,0,0,0.3);
    }
    .board {
      display: grid;
      grid-template-columns: repeat(3, 80px);
      grid-template-rows: repeat(3, 80px);
      gap: 8px;
      margin-bottom: 16px;
    }
    .cell {
      background: rgba(255,255,255,0.1);
      border: 2px solid rgba(255,255,255,0.2);
      border-radius: 12px;
      font-size: 40px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }
    .cell:hover:not(.taken):not(.game-over) {
      background: rgba(255,255,255,0.2);
      transform: scale(1.05);
    }
    .cell.taken {
      cursor: not-allowed;
    }
    .cell.game-over {
      cursor: not-allowed;
    }
    .cell.X { color: #00d4ff; text-shadow: 0 0 20px #00d4ff; }
    .cell.O { color: #ff6b6b; text-shadow: 0 0 20px #ff6b6b; }
    .cell.winning {
      background: rgba(255,215,0,0.3);
      border-color: gold;
      animation: pulse 0.5s ease infinite alternate;
    }
    @keyframes pulse {
      from { transform: scale(1); }
      to { transform: scale(1.08); }
    }
    .status {
      font-size: 18px;
      margin-bottom: 12px;
      min-height: 24px;
    }
    .status.winner { color: #ffd700; font-weight: bold; }
    .status.draw { color: #aaa; }
    button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      border-radius: 8px;
      color: white;
      padding: 12px 24px;
      font-size: 16px;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 15px rgba(102,126,234,0.4);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .loading {
      opacity: 0.6;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <h2>Tic-Tac-Toe v2</h2>
  <div class="status" id="status">Click a cell to start!</div>
  <div class="board" id="board"></div>
  <button id="newGameBtn" onclick="newGame()">New Game</button>

  <script>
    let requestId = 0;
    const pendingRequests = new Map();
    let currentState = null;
    let isLoading = false;

    // Initialize board cells
    function initBoard() {
      const board = document.getElementById('board');
      board.innerHTML = '';
      for (let i = 0; i < 9; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.index = i;
        cell.onclick = () => makeMove(i);
        board.appendChild(cell);
      }
    }

    // Call a tool on the MCP server
    function callTool(name, args) {
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        pendingRequests.set(id, { resolve, reject });

        console.log('[UI] Calling tool:', name, args);
        window.parent.postMessage({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name, arguments: args },
          id
        }, "*");

        // Timeout after 10s
        setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error('Request timeout'));
          }
        }, 10000);
      });
    }

    // Handle messages from host
    window.addEventListener('message', (event) => {
      const msg = event.data;
      console.log('[UI] Received message:', msg);

      // Handle JSON-RPC responses (for our tool calls)
      if (msg && msg.jsonrpc === "2.0" && msg.id && pendingRequests.has(msg.id)) {
        const { resolve, reject } = pendingRequests.get(msg.id);
        pendingRequests.delete(msg.id);

        if (msg.error) {
          reject(new Error(msg.error.message || 'Tool call failed'));
        } else {
          resolve(msg.result);
        }
        return;
      }

      // Handle tool result notification (initial render)
      if (msg && msg.method === 'ui/notifications/tool-result') {
        const result = msg.params;
        if (result && result.structuredContent) {
          renderState(result.structuredContent);
        }
      }
    });

    // Render the game state
    function renderState(state) {
      currentState = state;
      const cells = document.querySelectorAll('.cell');

      cells.forEach((cell, i) => {
        const value = state.board[i];
        cell.textContent = value;
        cell.className = 'cell';
        if (value) {
          cell.classList.add('taken', value);
        }
        if (state.gameOver) {
          cell.classList.add('game-over');
        }
        if (state.winningLine && state.winningLine.includes(i)) {
          cell.classList.add('winning');
        }
      });

      const statusEl = document.getElementById('status');
      statusEl.className = 'status';

      if (state.winner === 'X') {
        statusEl.textContent = '🎉 You win!';
        statusEl.classList.add('winner');
      } else if (state.winner === 'O') {
        statusEl.textContent = '🤖 AI wins!';
        statusEl.classList.add('winner');
      } else if (state.winner === 'draw') {
        statusEl.textContent = "It's a draw!";
        statusEl.classList.add('draw');
      } else {
        statusEl.textContent = state.currentPlayer === 'X' ? 'Your turn (X)' : 'AI thinking...';
      }

      setLoading(false);
    }

    function setLoading(loading) {
      isLoading = loading;
      document.getElementById('board').classList.toggle('loading', loading);
      document.getElementById('newGameBtn').disabled = loading;
    }

    // Make a move
    async function makeMove(position) {
      if (isLoading) return;
      if (currentState && (currentState.gameOver || currentState.board[position])) return;

      setLoading(true);
      document.getElementById('status').textContent = 'Making move...';

      try {
        const result = await callTool('tictactoe_move', { position });
        if (result && result.structuredContent) {
          renderState(result.structuredContent);
        }
      } catch (err) {
        console.error('[UI] Move failed:', err);
        document.getElementById('status').textContent = 'Move failed: ' + err.message;
        setLoading(false);
      }
    }

    // Start a new game
    async function newGame() {
      if (isLoading) return;

      setLoading(true);
      document.getElementById('status').textContent = 'Starting new game...';

      try {
        const result = await callTool('tictactoe_new_game', {});
        if (result && result.structuredContent) {
          renderState(result.structuredContent);
        }
      } catch (err) {
        console.error('[UI] New game failed:', err);
        document.getElementById('status').textContent = 'Failed to start: ' + err.message;
        setLoading(false);
      }
    }

    // Request size from host (both MCP Apps SEP and MCP-UI formats)
    function requestSize(width, height) {
      // MCP Apps SEP format
      window.parent.postMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/size-change",
        params: { width, height }
      }, "*");

      // MCP-UI format (for LibreChat and other MCP-UI hosts)
      window.parent.postMessage({
        type: "ui-size-change",
        payload: { width, height }
      }, "*");
    }

    // Initialize
    initBoard();

    // Set initial empty state
    currentState = {
      board: ['', '', '', '', '', '', '', '', ''],
      currentPlayer: 'X',
      winner: null,
      gameOver: false,
      winningLine: null
    };
    renderState(currentState);

    // Request adequate size from host
    requestSize(320, 480);
  </script>
</body>
</html>
`;

const getServer = () => {
  // Create an MCP server with implementation details
  const server = new McpServer({
    name: `mcp-server-port-${PORT}`,
    version: '1.0.0',
  }, { capabilities: { logging: {}, resources: {} } });

  // Register the UI resource for Tic-Tac-Toe
  server.resource(
    'tictactoe-ui',
    'ui://tictactoe',
    {
      description: 'Interactive Tic-Tac-Toe game UI',
      mimeType: 'text/html',
    },
    async (): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: 'ui://tictactoe',
          mimeType: 'text/html',
          text: TICTACTOE_UI_HTML,
        }
      ],
    })
  );

  // Tool to make a move in the game
  server.registerTool(
    'tictactoe_move',
    {
      description: 'Make a move in the Tic-Tac-Toe game. You are X, AI is O.',
      inputSchema: {
        position: z.number().min(0).max(8).describe('Board position (0-8, left-to-right, top-to-bottom)'),
      },
      _meta: {
        [RESOURCE_URI_META_KEY]: 'ui://tictactoe',
      },
    },
    async ({ position }: { position: number }): Promise<CallToolResult> => {
      const userId = atxpAccountId() || 'default';
      await requirePayment({ price: BigNumber(0.01) });

      // Get or create game state for this user
      let state = gameStates.get(userId);
      if (!state) {
        state = createInitialState();
        gameStates.set(userId, state);
      }

      // Validate move
      if (state.gameOver) {
        return {
          content: [{ type: 'text', text: 'Game is over. Start a new game.' }],
          structuredContent: state,
          isError: true,
        };
      }

      if (state.board[position] !== '') {
        return {
          content: [{ type: 'text', text: `Position ${position} is already taken.` }],
          structuredContent: state,
          isError: true,
        };
      }

      // Make player's move (X)
      state.board[position] = 'X';
      let result = checkWinner(state.board);

      if (result.winner) {
        state.winner = result.winner;
        state.winningLine = result.winningLine;
        state.gameOver = true;
      } else {
        // AI's turn (O)
        const aiPosition = makeAIMove(state.board);
        state.board[aiPosition] = 'O';
        result = checkWinner(state.board);

        if (result.winner) {
          state.winner = result.winner;
          state.winningLine = result.winningLine;
          state.gameOver = true;
        }
      }

      state.currentPlayer = state.gameOver ? state.currentPlayer : 'X';

      const statusText = state.winner === 'X' ? 'You win!'
        : state.winner === 'O' ? 'AI wins!'
        : state.winner === 'draw' ? "It's a draw!"
        : 'Your turn';

      return {
        content: [{ type: 'text', text: `Move made. ${statusText}` }],
        structuredContent: state,
      };
    }
  );

  // Tool to start a new game
  server.registerTool(
    'tictactoe_new_game',
    {
      description: 'Start a new Tic-Tac-Toe game',
      inputSchema: {},
      _meta: {
        [RESOURCE_URI_META_KEY]: 'ui://tictactoe',
      },
    },
    async (): Promise<CallToolResult> => {
      const userId = atxpAccountId() || 'default';
      await requirePayment({ price: BigNumber(0.01) });

      const state = createInitialState();
      gameStates.set(userId, state);

      return {
        content: [{ type: 'text', text: 'New game started. You are X, make your move!' }],
        structuredContent: state,
      };
    }
  );

  // Secure data tool for testing authenticated requests
  server.registerTool(
    'secure-data',
    {
      description: 'A secure endpoint that requires authentication. Echoes back the provided message.',
      inputSchema: {
        message: z.string().optional().describe('Optional message to echo back'),
      },
    },
    async ({ message }: { message?: string }): Promise<CallToolResult> => {
      const userId = atxpAccountId() || 'anonymous';
      await requirePayment({ price: BigNumber(0.01) });

      const responseMessage = message
        ? `Secure response for user ${userId}: ${message}`
        : `Secure response for user ${userId}: Hello from the secure endpoint!`;

      return {
        content: [{ type: 'text', text: responseMessage }],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

const logger = new ConsoleLogger({level: LogLevel.DEBUG});

//const destinationConnectionString = process.env.ATXP_DESTINATION!;
//const destination = new ATXPAccount(destinationConnectionString);
const destinationAccountId = process.env.ATXP_DESTINATION_ACCOUNT!;
const destination = new AccountIdDestination(destinationAccountId);
console.log('Starting MCP server with destination', destinationAccountId);

app.use(atxpExpress({
  destination: destination,
  server: 'http://localhost:3010',
  payeeName: 'ATXP Client Example Resource Server',
  minimumPayment: BigNumber(0.01),
  allowHttp: true,
  logger
}));


app.post('/', async (req: Request, res: Response) => {
  const server = getServer();
  try {
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      console.log('Request closed');
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

app.get('/', async (req: Request, res: Response) => {
  console.log('Received GET MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

app.delete('/', async (req: Request, res: Response) => {
  console.log('Received DELETE MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});


// Start the server
app.listen(PORT, (error) => {
  if (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
  console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  process.exit(0);
});

// Web API implementations for Cloudflare Workers, Deno, browsers, etc.
// These functions adapt Web API Request/Response to use the core business logic

export { checkTokenWebApi } from './token.js';
export { sendOAuthChallengeWebApi, sendProtectedResourceMetadata as sendProtectedResourceMetadataWebApi, sendOAuthMetadata as sendOAuthMetadataWebApi } from './oauth.js';
export { parseMcpRequestsWebApi } from './mcp.js';
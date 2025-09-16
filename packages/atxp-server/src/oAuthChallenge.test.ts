import { describe, it, expect } from 'vitest';
import * as TH from './serverTestHelpers.js';
import { TokenProblem } from './types.js';
import { sendOAuthChallenge } from './node/oauth.js';

describe('oAuthChallenge', () => {
  it('should return false if the token check passes', async () => {
    const check = TH.tokenCheck({
      passes: true,
      resourceMetadataUrl: 'https://example.com/.well-known/oauth-protected-resource'
    });
    const res = TH.serverResponse();
    const ended = await sendOAuthChallenge(res, check);
    expect(ended).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('handles NO_TOKEN', async () => {
    const resourceMetadataUrl = 'https://example.com/.well-known/oauth-protected-resource';
    const check = TH.tokenCheck({
      passes: false,
      problem: TokenProblem.NO_TOKEN,
      resourceMetadataUrl
    });
    const res = TH.serverResponse();
    const ended = await sendOAuthChallenge(res, check);
    expect(ended).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ }));
  });

  it('handles NON_BEARER_AUTH_HEADER', async () => {
    const resourceMetadataUrl = 'https://example.com/.well-known/oauth-protected-resource';
    const check = TH.tokenCheck({
      passes: false,
      problem: TokenProblem.NON_BEARER_AUTH_HEADER,
      resourceMetadataUrl
    });
    const res = TH.serverResponse();
    const ended = await sendOAuthChallenge(res, check);
    expect(ended).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ 
      error: 'invalid_request', 
      error_description: 'Authorization header did not include a Bearer token' 
    }));
  });

  it('handles INVALID_TOKEN', async () => {
    const resourceMetadataUrl = 'https://example.com/.well-known/oauth-protected-resource';
    const check = TH.tokenCheck({
      passes: false,
      problem: TokenProblem.INVALID_TOKEN,
      resourceMetadataUrl
    });
    const res = TH.serverResponse();
    const ended = await sendOAuthChallenge(res, check);
    expect(ended).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ 
      error: 'invalid_token', 
      error_description: 'Token is not active' 
    }));
  });

  it('handles INVALID_AUDIENCE', async () => {
    const resourceMetadataUrl = 'https://example.com/.well-known/oauth-protected-resource';
    const check = TH.tokenCheck({
      passes: false,
      problem: TokenProblem.INVALID_AUDIENCE,
      resourceMetadataUrl
    });
    const res = TH.serverResponse();
    const ended = await sendOAuthChallenge(res, check);
    expect(ended).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({
      error: 'invalid_token',
      error_description: 'Token does not match the expected audience'
    }));
  });

  it('handles NON_SUFFICIENT_FUNDS', async () => {
    const resourceMetadataUrl = 'https://example.com/.well-known/oauth-protected-resource';
    const check = TH.tokenCheck({
      passes: false,
      problem: TokenProblem.NON_SUFFICIENT_FUNDS,
      resourceMetadataUrl
    });
    const res = TH.serverResponse();
    const ended = await sendOAuthChallenge(res, check);
    expect(ended).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(403);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ 
      error: 'insufficient_scope', 
      error_description: 'Non sufficient funds' 
    }));
  });

  it('handles INTROSPECT_ERROR', async () => {
    const resourceMetadataUrl = 'https://example.com/.well-known/oauth-protected-resource';
    const check = TH.tokenCheck({
      passes: false,
      problem: TokenProblem.INTROSPECT_ERROR,
      resourceMetadataUrl
    });
    const res = TH.serverResponse();
    const ended = await sendOAuthChallenge(res, check);
    expect(ended).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(502);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ 
      error: 'server_error', 
      error_description: 'An internal server error occurred' 
    }));
  });
});
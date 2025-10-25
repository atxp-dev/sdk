import { FetchMock } from 'fetch-mock';
import { DEFAULT_AUTHORIZATION_SERVER } from '@atxp/common';

export function mockResourceServer(mock: FetchMock, baseUrl: string = 'https://example.com', resourcePath: string = '/mcp', authServerUrl: string = DEFAULT_AUTHORIZATION_SERVER) {
  mock.route({
    name: `${baseUrl}/.well-known/oauth-protected-resource${resourcePath}`,
    url: `${baseUrl}/.well-known/oauth-protected-resource${resourcePath}`,
    response: {
      body: {
        resource: baseUrl + resourcePath,
        authorization_servers: [authServerUrl]
      }
    }
  });
  mock.route({
    name: `GET ${baseUrl}${resourcePath}`,
    url: `${baseUrl}${resourcePath}`,
    method: 'get',
    response: {
      // Indicate that SSE is not supported - clients can only POST to this MCP server
      status: 405
    }
  })
  return mock;
}

export function mockAuthorizationServer(mock: FetchMock, baseUrl: string = DEFAULT_AUTHORIZATION_SERVER, paymentRequests: {[key: string]: BigNumber} = {}) {
  mock.get(`${baseUrl}/.well-known/oauth-authorization-server`, {
    issuer: `${baseUrl}`,
    authorization_endpoint: `${baseUrl}/authorize`,
    registration_endpoint: `${baseUrl}/register`,
    token_endpoint: `${baseUrl}/token`,
    introspection_endpoint: `${baseUrl}/introspect`
  });
  // Use the more verbose route method to name the route, so we can .modifyRoute it later
  mock.route({
    name: `${baseUrl}/token`,
    url: `${baseUrl}/token`,
    method: 'post',
    repeat: 1,
    response: {
      access_token: 'testAccessToken',
      refresh_token: 'testRefreshToken',
      token_type: 'Bearer',
      expires_in: 3600
    }
  });
  mock.route({
    name: `${baseUrl}/register`,
    url: `${baseUrl}/register`, 
    method: 'post',
    response: {
      status: 201,
      body: {
        client_id: 'testClientId',
        client_secret: 'testClientSecret',
        client_secret_expires_at: Date.now() + 1000 * 60 * 60 * 24 * 30
      }
    }
  });
  mock.route({
    name: `${baseUrl}/introspect`,
    url: `${baseUrl}/introspect`,
    method: 'post',
    repeat: 1,
    response: {
      active: true,
      client_id: 'testClientId',
      username: 'testUsername',
      sub: 'testUser'
    }
  });
  for (const [paymentRequestId, amount] of Object.entries(paymentRequests)) {
    mock.route({
      name: `get ${baseUrl}/payment-request/${paymentRequestId}`,
      url: `${baseUrl}/payment-request/${paymentRequestId}`,
      method: 'get',
      response: {
        destinations: [{
          amount: amount.toString(),
          currency: 'USDC',
          network: 'solana',
          address: 'testDestination'
        }],
        resourceName: 'testResourceName'
      }
    });
    mock.route({
      name: `put ${baseUrl}/payment-request/${paymentRequestId}`,
      url: `${baseUrl}/payment-request/${paymentRequestId}`,
      method: 'put',
      response: {
        status: 200
      }
    });
  }
  return mock;
}
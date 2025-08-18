import { PAYMENT_REQUIRED_ERROR_CODE, PAYMENT_REQUIRED_PREAMBLE } from './paymentRequiredError.js';
import { AuthorizationServerUrl } from './types.js';
import { CallToolResult, isJSONRPCError, isJSONRPCResponse, JSONRPCError, JSONRPCMessage, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from './types.js';
import { ZodError } from 'zod';
import { isSSEResponse, parseSSEMessages, extractJSONFromSSE } from './sseParser.js';

export function parsePaymentRequests(message: JSONRPCMessage): {url: AuthorizationServerUrl, id: string}[] {
  const res = [];
  // Handle MCP protocol-level errors. These have an explicit error code that we can check for
  if (isJSONRPCError(message)){
    // Explicitly throw payment required errors that result in MCP protocol-level errors
    const rpcError = message as JSONRPCError;
    if (rpcError.error.code === PAYMENT_REQUIRED_ERROR_CODE) {
      const paymentRequestUrl = (rpcError.error.data as {paymentRequestUrl: string})?.paymentRequestUrl;
      const dataPr = _parsePaymentRequestFromString(paymentRequestUrl);
      if(dataPr) {
        res.push(dataPr);
      } else {
        const pr = _parsePaymentRequestFromString(rpcError.error.message);
        if(pr) {
          res.push(pr);
        }
      }
    }
    // Elicitation - required errors
    // Current draft of elicitation-required error code as per
    // https://github.com/modelcontextprotocol/modelcontextprotocol/pull/887
    if (rpcError.error.code === -32604) {
      const elicitations = (rpcError.error.data as {elicitations: {mode: string, url: string}[]}|undefined)?.elicitations || [];
      for(const elicitation of elicitations) {
        if(elicitation?.mode === 'url') {
          const pr = _parsePaymentRequestFromString(elicitation?.url);
          if(pr) {
            res.push(pr);
          }
        }
      }
    }
  }

  // TODO: Ensure that ATXP errors only come back as MCP protocol-level errors.
  // Handle MCP tool application-level errors. For these, the error message is serialized into a normal 
  // tool response with the isError flag set
  if (isJSONRPCResponse(message)){
    const toolResult = message.result as CallToolResult;
    if(toolResult.isError) {
      for(const content of toolResult.content) {
        if(content.type === 'text') {
          const text = content.text;
          if(text.includes(PAYMENT_REQUIRED_PREAMBLE) && text.includes(PAYMENT_REQUIRED_ERROR_CODE.toString())) {
            const pr = _parsePaymentRequestFromString(text);
            if(pr) {
              res.push(pr);
            }
          }
        }
      }
    }
  }
  return res;
}

function _parsePaymentRequestFromString(text: string | null): {url: AuthorizationServerUrl, id: string} | null {
  if (!text) {
    return null;
  }
  const paymentRequestUrl = /(http[^ ]+)\/payment-request\/([^ ]+)/.exec(text);
  if (paymentRequestUrl) {
    const id = paymentRequestUrl[2];
    const url = paymentRequestUrl[0] as AuthorizationServerUrl;
    return {url, id};
  }
  return null;
}

export async function parseMcpMessages(json: unknown, logger?: Logger): Promise<JSONRPCMessage[]> {
  let messages: JSONRPCMessage[] = [];

  try {
    // Check if the response is SSE formatted
    if (typeof json === 'string' && isSSEResponse(json)) {
      logger?.debug('Detected SSE-formatted response, parsing SSE messages');
      const sseMessages = parseSSEMessages(json);
      const jsonMessages = extractJSONFromSSE(sseMessages, logger);
      
      // Process each JSON message from SSE
      for (const jsonMsg of jsonMessages) {
        try {
          if (Array.isArray(jsonMsg)) {
            // Handle batch messages from SSE
            const batchMessages = jsonMsg.map(msg => JSONRPCMessageSchema.parse(msg));
            messages.push(...batchMessages);
          } else {
            // Handle single message from SSE
            const message = JSONRPCMessageSchema.parse(jsonMsg);
            messages.push(message);
          }
        } catch (parseError) {
          if (parseError instanceof ZodError) {
            logger?.warn(`Invalid JSON-RPC message format in SSE data`);
            logger?.debug(parseError.message);
          } else {
            logger?.error(`Unexpected error parsing JSON-RPC message from SSE: ${parseError}`);
          }
        }
      }
    } else {
      // Handle regular JSON responses
      if (Array.isArray(json)) {
        messages = json.map(msg => JSONRPCMessageSchema.parse(msg));
      } else {
        messages = [JSONRPCMessageSchema.parse(json)];
      }
    }
  } catch (error) {
    // If Zod validation fails, log the error and return empty array
    if (error instanceof ZodError) {
      logger?.warn(`Invalid JSON-RPC message format`);
      logger?.debug(error.message);
    } else {
      logger?.error(`Unexpected error parsing JSON-RPC messages: ${error}`);
    }
  }
  return messages;
}
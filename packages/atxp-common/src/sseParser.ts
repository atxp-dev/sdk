import { Logger } from './types.js';

export interface SSEMessage {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

/**
 * Parses SSE (Server-Sent Events) formatted text into individual messages
 * @param sseText - The raw SSE text to parse
 * @returns Array of parsed SSE messages
 */
export function parseSSEMessages(sseText: string): SSEMessage[] {
  const messages: SSEMessage[] = [];
  const lines = sseText.split('\n');
  
  let currentMessage: Partial<SSEMessage> = {};
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Empty line indicates end of message
    if (trimmedLine === '') {
      if (currentMessage.data !== undefined) {
        messages.push(currentMessage as SSEMessage);
        currentMessage = {};
      }
      continue;
    }
    
    // Parse field: value format
    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex === -1) {
      continue; // Skip malformed lines
    }
    
    const field = trimmedLine.substring(0, colonIndex);
    const value = trimmedLine.substring(colonIndex + 1);
    let retryValue: number | undefined;
    
    switch (field) {
      case 'event':
        currentMessage.event = value;
        break;
      case 'data':
        // SSE spec allows multiple data fields to be concatenated
        currentMessage.data = currentMessage.data ? currentMessage.data + '\n' + value : value;
        break;
      case 'id':
        currentMessage.id = value;
        break;
      case 'retry':
        retryValue = parseInt(value, 10);
        if (!isNaN(retryValue)) {
          currentMessage.retry = retryValue;
        }
        break;
    }
  }
  
  // Don't forget the last message if it doesn't end with an empty line
  if (currentMessage.data !== undefined) {
    messages.push(currentMessage as SSEMessage);
  }
  
  return messages;
}

/**
 * Extracts JSON-RPC messages from SSE data fields
 * @param sseMessages - Array of SSE messages
 * @param logger - Optional logger for debugging
 * @returns Array of parsed JSON objects from SSE data fields
 */
export function extractJSONFromSSE(sseMessages: SSEMessage[], logger?: Logger): unknown[] {
  const jsonMessages: unknown[] = [];
  
  for (const sseMessage of sseMessages) {
    try {
      if (sseMessage.data) {
        const parsed = JSON.parse(sseMessage.data);
        jsonMessages.push(parsed);
      }
    } catch (error) {
      logger?.warn(`Failed to parse SSE data as JSON: ${sseMessage.data}`);
      logger?.debug(`Parse error: ${error}`);
    }
  }
  
  return jsonMessages;
}

/**
 * Determines if a response body appears to be SSE formatted
 * @param body - The response body to check
 * @returns true if the body appears to be SSE formatted
 */
export function isSSEResponse(body: unknown): boolean {
  if (typeof body !== 'string') {
    return false;
  }
  
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine === '') continue;
    
    // Check for SSE field format (field: value)
    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex === -1) continue;
    
    const field = trimmedLine.substring(0, colonIndex);
    if (['event', 'data', 'id', 'retry'].includes(field)) {
      return true;
    }
  }
  
  return false;
} 
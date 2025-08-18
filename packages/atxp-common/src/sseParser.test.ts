import { describe, it, expect, vi } from 'vitest';
import { extractJSONFromSSE, isSSEResponse, parseSSEMessages } from './sseParser.js';

describe('sseParser', () => {
  describe('parseSSEMessages', () => {
    it('parses a single message with all fields', () => {
      const sseText = [
        'event:my-event',
        'data:{"foo":"bar"}',
        'id:1',
        'retry:1000',
        '',
      ].join('\n');

      const messages = parseSSEMessages(sseText);
      expect(messages).toEqual([
        {
          event: 'my-event',
          data: '{"foo":"bar"}',
          id: '1',
          retry: 1000,
        },
      ]);
    });

    it('concatenates multiple data lines and respects message boundaries', () => {
      const sseText = [
        'data:first',
        'data:second',
        '',
        'data:third',
        '',
      ].join('\n');

      const messages = parseSSEMessages(sseText);
      expect(messages).toEqual([
        { data: 'first\nsecond' },
        { data: 'third' },
      ]);
    });

    it('captures last message even without trailing blank line', () => {
      const sseText = ['data:last message'].join('\n');
      const messages = parseSSEMessages(sseText);
      expect(messages).toEqual([{ data: 'last message' }]);
    });

    it('ignores malformed lines without a colon', () => {
      const sseText = [
        'data:hello',
        'not-a-valid-line',
        'id:5',
        '',
      ].join('\n');

      const messages = parseSSEMessages(sseText);
      expect(messages).toEqual([
        { data: 'hello', id: '5' },
      ]);
    });
  });

  describe('extractJSONFromSSE', () => {
    it('parses valid JSON data values', () => {
      const sseMessages = [
        { data: '{"a":1}' },
        { data: '{"b":"two"}' },
      ];

      const parsed = extractJSONFromSSE(sseMessages);
      expect(parsed).toEqual([{ a: 1 }, { b: 'two' }]);
    });

    it('skips invalid JSON and logs warnings', () => {
      const sseMessages = [
        { data: '{"ok":true}' },
        { data: '{invalid json' },
      ];

      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const parsed = extractJSONFromSSE(sseMessages, logger);

      expect(parsed).toEqual([{ ok: true }]);
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe('isSSEResponse', () => {
    it('returns true when SSE fields are present', () => {
      const body = ['data:hello', '', ''].join('\n');
      expect(isSSEResponse(body)).toBe(true);
    });

    it('returns false for non-string inputs', () => {
      expect(isSSEResponse(123 as unknown as string)).toBe(false);
      expect(isSSEResponse({} as unknown as string)).toBe(false);
    });

    it('returns false when no recognized SSE fields are present', () => {
      const body = ['foo:bar', '', 'baz:qux'].join('\n');
      expect(isSSEResponse(body)).toBe(false);
    });
  });
});



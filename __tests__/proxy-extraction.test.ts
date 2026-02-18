import { describe, it, expect } from "vitest";
import { extractUsage, extractUsageFromSSE, isStreamingRequest } from "../server/proxy";

describe("extractUsage", () => {
  it("extracts all token types from a standard response", () => {
    const result = extractUsage({
      model: "claude-opus-4-6",
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 300,
      },
    });

    expect(result).toEqual({
      model: "claude-opus-4-6",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 2000,
      cacheCreationTokens: 300,
    });
  });

  it("defaults missing fields to 0 or 'unknown'", () => {
    const result = extractUsage({});
    expect(result).toEqual({
      model: "unknown",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it("handles response with usage but no cache tokens", () => {
    const result = extractUsage({
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 5000,
        output_tokens: 1000,
      },
    });

    expect(result).toEqual({
      model: "claude-sonnet-4-6",
      inputTokens: 5000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it("handles response with only cache tokens (no regular input)", () => {
    const result = extractUsage({
      model: "claude-opus-4-6",
      usage: {
        input_tokens: 0,
        output_tokens: 200,
        cache_read_input_tokens: 50000,
        cache_creation_input_tokens: 10000,
      },
    });

    expect(result.inputTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(50000);
    expect(result.cacheCreationTokens).toBe(10000);
  });
});

describe("extractUsageFromSSE", () => {
  it("extracts usage from a complete SSE stream", () => {
    const sseText = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-opus-4-6","usage":{"input_tokens":1000,"cache_read_input_tokens":5000,"cache_creation_input_tokens":200}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"text":"Hello"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":300}}',
      '',
    ].join('\n');

    const result = extractUsageFromSSE(sseText);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("claude-opus-4-6");
    expect(result!.inputTokens).toBe(1000);
    expect(result!.outputTokens).toBe(300);
    expect(result!.cacheReadTokens).toBe(5000);
    expect(result!.cacheCreationTokens).toBe(200);
  });

  it("returns null when no usage data found", () => {
    const sseText = [
      'event: ping',
      'data: {"type":"ping"}',
      '',
    ].join('\n');

    const result = extractUsageFromSSE(sseText);
    expect(result).toBeNull();
  });

  it("handles SSE with only message_start (no delta)", () => {
    const sseText = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":500,"cache_read_input_tokens":10000}}}',
      '',
    ].join('\n');

    const result = extractUsageFromSSE(sseText);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("claude-sonnet-4-6");
    expect(result!.inputTokens).toBe(500);
    expect(result!.cacheReadTokens).toBe(10000);
    expect(result!.outputTokens).toBe(0);
  });

  it("handles SSE with no cache tokens", () => {
    const sseText = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-opus-4-6","usage":{"input_tokens":2000}}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":800}}',
      '',
    ].join('\n');

    const result = extractUsageFromSSE(sseText);
    expect(result).not.toBeNull();
    expect(result!.cacheReadTokens).toBe(0);
    expect(result!.cacheCreationTokens).toBe(0);
    expect(result!.inputTokens).toBe(2000);
    expect(result!.outputTokens).toBe(800);
  });

  it("handles malformed JSON lines gracefully", () => {
    const sseText = [
      'event: message_start',
      'data: {invalid json}',
      '',
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-opus-4-6","usage":{"input_tokens":100}}}',
      '',
    ].join('\n');

    const result = extractUsageFromSSE(sseText);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(100);
  });

  it("handles [DONE] marker", () => {
    const sseText = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-opus-4-6","usage":{"input_tokens":100}}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = extractUsageFromSSE(sseText);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(100);
  });
});

describe("isStreamingRequest", () => {
  it("returns true for stream:true request", () => {
    const body = Buffer.from(JSON.stringify({ stream: true, model: "claude-opus-4-6" }));
    expect(isStreamingRequest(body)).toBe(true);
  });

  it("returns false for non-streaming request", () => {
    const body = Buffer.from(JSON.stringify({ stream: false, model: "claude-opus-4-6" }));
    expect(isStreamingRequest(body)).toBe(false);
  });

  it("returns false for request without stream field", () => {
    const body = Buffer.from(JSON.stringify({ model: "claude-opus-4-6" }));
    expect(isStreamingRequest(body)).toBe(false);
  });

  it("returns false for empty buffer", () => {
    expect(isStreamingRequest(Buffer.alloc(0))).toBe(false);
  });

  it("returns false for invalid JSON", () => {
    const body = Buffer.from("not json");
    expect(isStreamingRequest(body)).toBe(false);
  });
});

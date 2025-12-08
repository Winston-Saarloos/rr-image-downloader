/**
 * Tests for axiosRequest utility function
 *
 * This test suite verifies the HTTP request handling functionality, including:
 * - JSON response parsing with support for large integers (bigint)
 * - Binary data handling (ArrayBuffer, Buffer)
 * - Error handling for various failure scenarios
 * - GenericResponse format handling
 *
 * The axiosRequest function is critical for all API communication in the application,
 * so these tests ensure it correctly handles different response types and error conditions.
 */

// Mock axios before any imports
const mockRequest = jest.fn();
const mockAxiosInstance: { request: jest.Mock } = {
  request: jest.fn(),
};
let capturedTransformers: Array<(data: unknown) => unknown> = [];

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(
      (options?: { transformResponse?: Array<(d: any) => any> }) => {
        capturedTransformers = options?.transformResponse || [];
        mockAxiosInstance.request = jest.fn(async (config?: unknown) => {
          const resp = await mockRequest(config);
          let data = resp.data;
          for (const transformer of capturedTransformers) {
            data = transformer(data);
          }
          return { ...resp, data };
        });
        return mockAxiosInstance;
      }
    ),
    isAxiosError: jest.fn((error: unknown) => {
      return (
        typeof error === 'object' &&
        error !== null &&
        'isAxiosError' in error &&
        (error as { isAxiosError?: boolean }).isAxiosError === true
      );
    }),
  },
  isAxiosError: jest.fn((error: unknown) => {
    return (
      typeof error === 'object' &&
      error !== null &&
      'isAxiosError' in error &&
      (error as { isAxiosError?: boolean }).isAxiosError === true
    );
  }),
}));

import { axiosRequest, isAxiosError } from '../axiosRequest';
import { GenericResponse } from '../../models/GenericResponse';

describe('axiosRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest.mockClear();
    mockAxiosInstance.request.mockClear();
  });

  /**
   * Tests for JSON response parsing
   *
   * The axiosRequest function uses json-bigint to parse JSON responses,
   * which is necessary because the RecNet API returns large 64-bit integers
   * that would be truncated by standard JSON.parse(). These tests verify
   * that the parsing works correctly for various JSON formats.
   */
  describe('JSON response parsing', () => {
    /**
     * Verifies that standard JSON responses are parsed correctly.
     * This is the happy path for most API responses.
     */
    it('should parse JSON string responses correctly', async () => {
      const mockData = { id: '123', name: 'test' };
      mockRequest.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: mockData,
      });

      const result = await axiosRequest({
        url: 'https://api.example.com/test',
        method: 'GET',
      });

      expect(result.success).toBe(true);
      expect(result.value).toEqual(mockData);
      expect(result.status).toBe(200);
    });

    /**
     * Verifies that large integer values (64-bit) are preserved correctly.
     * The RecNet API uses large IDs that exceed JavaScript's safe integer limit.
     * json-bigint stores these as strings to prevent precision loss.
     *
     * This test will FAIL if the bigint logic is removed and standard JSON.parse()
     * is used instead, because the number will be truncated.
     */
    it('should handle large integer values in JSON (bigint)', async () => {
      // Use a number that exceeds Number.MAX_SAFE_INTEGER (2^53 - 1)
      // This number WILL be truncated by standard JSON.parse()
      // We must construct JSON with the number as a number (not string) to test truncation
      const largeNumber = '9223372036854775807'; // Max 64-bit signed int
      // Manually construct JSON with number (not string) to force truncation test
      const jsonString = `{"success":true,"value":{"id":${largeNumber}}}`;

      // Verify that standard JSON.parse() would truncate this number
      const standardParse = JSON.parse(jsonString);
      const truncatedValue = standardParse.value.id;
      // Standard parse converts to number, which loses precision
      // The truncated number (as string) should differ from the original string
      expect(truncatedValue.toString()).not.toBe(largeNumber); // String comparison proves truncation
      expect(typeof truncatedValue).toBe('number'); // Verify it's a number, not a string

      mockRequest.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        // axios will pass raw string through transformResponse
        data: jsonString,
      });

      const result = await axiosRequest({
        url: 'https://api.example.com/test',
        method: 'GET',
      });

      expect(result.success).toBe(true);
      expect(result.value).toBeDefined();
      // The bigint parser should preserve the exact value as a string
      expect((result.value as any).id).toBe(largeNumber);
      expect(typeof (result.value as any).id).toBe('string');

      // CRITICAL: Verify the value is NOT the truncated version
      // This assertion will fail if bigint parsing is removed
      expect((result.value as any).id).not.toBe(truncatedValue.toString());
    });

    /**
     * Verifies that the transformResponse function uses json-bigint, not standard JSON.parse.
     * This test will FAIL if someone replaces JSONbigString.parse() with JSON.parse().
     */
    it('should use json-bigint parser, not standard JSON.parse', async () => {
      // Number that exceeds Number.MAX_SAFE_INTEGER and will lose precision with JSON.parse()
      // 9007199254740993 (2^53 + 1) gets rounded to 9007199254740992 by standard JSON.parse()
      const largeNumber = '9007199254740993'; // Will be truncated by standard JSON.parse()
      // Manually construct JSON with number (not string) to force truncation test
      const jsonString = `{"id":${largeNumber}}`;

      mockRequest.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: jsonString,
      });

      const result = await axiosRequest({
        url: 'https://api.example.com/test',
        method: 'GET',
      });

      // Standard JSON.parse() would return a number (potentially imprecise)
      // json-bigint with storeAsString: true returns a string
      const parsedValue = (result.value as any).id;

      // If bigint parsing is removed, this will fail:
      expect(typeof parsedValue).toBe('string');
      expect(parsedValue).toBe(largeNumber);

      // Verify it's not the truncated number
      // Standard JSON.parse() will round 9007199254740993 to 9007199254740000
      const standardParsed = JSON.parse(jsonString);
      expect(parsedValue).not.toBe(standardParsed.id.toString());
      expect(standardParsed.id.toString()).toBe('9007199254740992'); // Verify truncation occurs
    });

    /**
     * Verifies that empty string responses are handled gracefully.
     * Some API endpoints may return empty responses, and we should handle
     * them without throwing errors.
     */
    it('should handle empty string responses', async () => {
      mockRequest.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: '',
      });

      const result = await axiosRequest({
        url: 'https://api.example.com/test',
        method: 'GET',
      });

      expect(result.success).toBe(true);
    });

    /**
     * Verifies that malformed JSON responses don't crash the application.
     * If the API returns invalid JSON, we should catch the error and
     * return a valid response object rather than throwing.
     */
    it('should handle invalid JSON gracefully', async () => {
      mockRequest.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: 'invalid json {',
      });

      const result = await axiosRequest({
        url: 'https://api.example.com/test',
        method: 'GET',
      });

      // Should not throw, but may return undefined for data
      expect(result).toBeDefined();
    });
  });

  /**
   * Tests for binary data handling
   *
   * When downloading photos, the API returns binary image data.
   * These tests verify that binary responses (ArrayBuffer, Buffer) are
   * passed through without modification, as they should not be parsed as JSON.
   */
  describe('Binary response handling', () => {
    /**
     * Verifies that ArrayBuffer responses (used for binary image downloads)
     * are returned unmodified. ArrayBuffers should not be parsed as JSON.
     */
    it('should handle ArrayBuffer responses (binary data)', async () => {
      const mockBuffer = new ArrayBuffer(8);
      const view = new Uint8Array(mockBuffer);
      view[0] = 0xff;
      view[1] = 0xd8; // JPEG header

      mockRequest.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: mockBuffer,
      });

      const result = await axiosRequest<ArrayBuffer>({
        url: 'https://cdn.example.com/image.jpg',
        method: 'GET',
        responseType: 'arraybuffer',
      });

      expect(result.success).toBe(true);
      expect(result.value).toBeInstanceOf(ArrayBuffer);
    });

    /**
     * Verifies that Node.js Buffer objects are handled correctly.
     * In Node.js environments, axios may return Buffer objects instead of ArrayBuffer.
     * Both should be preserved without JSON parsing.
     */
    it('should handle Buffer responses (Node.js)', async () => {
      const mockBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      mockRequest.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: mockBuffer,
      });

      const result = await axiosRequest<Buffer>({
        url: 'https://cdn.example.com/image.jpg',
        method: 'GET',
        responseType: 'arraybuffer',
      });

      expect(result.success).toBe(true);
      expect(Buffer.isBuffer(result.value)).toBe(true);
    });
  });

  /**
   * Tests for error handling
   *
   * Network requests can fail in various ways. These tests verify that
   * all error scenarios are handled gracefully and return appropriate
   * error information in the GenericResponse format.
   */
  describe('Error handling', () => {
    /**
     * Verifies that HTTP error status codes (4xx, 5xx) are properly
     * converted to GenericResponse format with success: false.
     */
    it('should handle HTTP error status codes', async () => {
      mockRequest.mockResolvedValue({
        status: 404,
        statusText: 'Not Found',
        data: null,
      });

      const result = await axiosRequest({
        url: 'https://api.example.com/notfound',
        method: 'GET',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
      expect(result.message).toBe('Not Found');
    });

    /**
     * Verifies that network-level errors (connection refused, timeout, etc.)
     * are caught and converted to GenericResponse format. These errors occur
     * when the request cannot reach the server, not just HTTP errors.
     */
    it('should handle network errors', async () => {
      const networkError = new Error('Network Error');
      (networkError as any).isAxiosError = true;
      (networkError as any).code = 'ECONNREFUSED';
      (networkError as any).response = undefined;

      mockRequest.mockRejectedValue(networkError);

      const result = await axiosRequest({
        url: 'https://api.example.com/test',
        method: 'GET',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
      expect(result.message).toBe('Network Error');
    });

    /**
     * Verifies that axios errors that include a response object
     * (like 500 errors) are handled correctly. These are different from
     * network errors because the server was reached but returned an error.
     */
    it('should handle axios errors with response', async () => {
      const axiosError = new Error('Request failed');
      (axiosError as any).isAxiosError = true;
      (axiosError as any).response = {
        status: 500,
        statusText: 'Internal Server Error',
      };
      (axiosError as any).code = undefined;

      mockRequest.mockRejectedValue(axiosError);

      const result = await axiosRequest({
        url: 'https://api.example.com/test',
        method: 'GET',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toBe('NETWORK_ERROR');
    });

    /**
     * Verifies that unexpected error types (not axios errors) are handled.
     * This is a safety net to ensure the function never throws unhandled exceptions.
     */
    it('should handle unknown errors', async () => {
      const unknownError = new Error('Unknown error');

      mockRequest.mockRejectedValue(unknownError);

      const result = await axiosRequest({
        url: 'https://api.example.com/test',
        method: 'GET',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNKNOWN_ERROR');
      expect(result.message).toBe('Unknown error');
    });
  });

  /**
   * Tests for the isAxiosError type guard function
   *
   * This utility function helps distinguish axios errors from other error types,
   * which is important for proper error handling.
   */
  describe('isAxiosError', () => {
    /**
     * Verifies that the type guard correctly identifies axios errors
     * by checking for the isAxiosError property.
     */
    it('should correctly identify axios errors', () => {
      const error = new Error('Test error');
      (error as any).isAxiosError = true;

      expect(isAxiosError(error)).toBe(true);
    });

    /**
     * Verifies that regular Error objects are not identified as axios errors.
     */
    it('should return false for non-axios errors', () => {
      const error = new Error('Test error');

      expect(isAxiosError(error)).toBe(false);
    });
  });

  /**
   * Tests for GenericResponse format handling
   *
   * The RecNet API sometimes returns responses in a GenericResponse wrapper format
   * with { success, value, ... } structure. These tests verify that both
   * wrapped and unwrapped responses are handled correctly.
   */
  describe('GenericResponse handling', () => {
    /**
     * Verifies that responses already in GenericResponse format are returned as-is.
     * Some API endpoints return data wrapped in this format.
     */
    it('should handle GenericResponse format correctly', async () => {
      const genericResponse: GenericResponse<string> = {
        success: true,
        value: 'test value',
        status: 200,
      };

      mockRequest.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: genericResponse,
      });

      const result = await axiosRequest<string>({
        url: 'https://api.example.com/test',
        method: 'GET',
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('test value');
    });

    /**
     * Verifies that plain JSON objects (not wrapped in GenericResponse)
     * are automatically wrapped in the GenericResponse format for consistency.
     */
    it('should handle non-GenericResponse data', async () => {
      const plainData = { id: '123', name: 'test' };

      mockRequest.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: plainData,
      });

      const result = await axiosRequest({
        url: 'https://api.example.com/test',
        method: 'GET',
      });

      expect(result.success).toBe(true);
      expect(result.value).toEqual(plainData);
    });
  });
});

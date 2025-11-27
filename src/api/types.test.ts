import { describe, expect, it } from 'vitest';

import { IESApiError } from './types.js';

describe('IESApiError', () => {
  describe('constructor', () => {
    it('should create error with message only', () => {
      const error = new IESApiError('Test error');

      expect(error.message).toBe('Test error');
      expect(error.name).toBe('IESApiError');
      expect(error.statusCode).toBeUndefined();
      expect(error.isAuthError).toBe(false);
    });

    it('should create error with message and status code', () => {
      const error = new IESApiError('Not found', 404);

      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
      expect(error.isAuthError).toBe(false);
    });

    it('should create auth error', () => {
      const error = new IESApiError('Authentication failed', 401, true);

      expect(error.message).toBe('Authentication failed');
      expect(error.statusCode).toBe(401);
      expect(error.isAuthError).toBe(true);
    });

    it('should be instanceof Error', () => {
      const error = new IESApiError('Test');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(IESApiError);
    });

    it('should have correct stack trace', () => {
      const error = new IESApiError('Test error');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('IESApiError');
    });
  });
});

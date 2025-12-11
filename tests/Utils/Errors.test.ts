import { describe, it, expect } from 'vitest';
import { AppError, ConfigurationError, FlixPatrolError, TraktError } from '../../src/Utils/Errors';

describe('Error classes', () => {
  describe('AppError', () => {
    it('should create an AppError with correct name and message', () => {
      const error = new AppError('Test error message');
      expect(error.name).toBe('AppError');
      expect(error.message).toBe('Test error message');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
    });
  });

  describe('ConfigurationError', () => {
    it('should create a ConfigurationError with correct name and message', () => {
      const error = new ConfigurationError('Invalid config');
      expect(error.name).toBe('ConfigurationError');
      expect(error.message).toBe('Invalid config');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(ConfigurationError);
    });
  });

  describe('FlixPatrolError', () => {
    it('should create a FlixPatrolError with correct name and message', () => {
      const error = new FlixPatrolError('Unable to fetch page');
      expect(error.name).toBe('FlixPatrolError');
      expect(error.message).toBe('Unable to fetch page');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(FlixPatrolError);
    });
  });

  describe('TraktError', () => {
    it('should create a TraktError with correct name and message', () => {
      const error = new TraktError('API call failed');
      expect(error.name).toBe('TraktError');
      expect(error.message).toBe('API call failed');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(TraktError);
    });
  });
});
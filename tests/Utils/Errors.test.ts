import { describe, it, expect } from 'vitest';
import {
  AppError, ConfigurationError, FlixPatrolError, TraktError, TargetError, FloppyError, MdblistError,
} from '../../src/Utils/Errors';

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

describe('target errors', () => {
  it('TargetError carries the backend name and derives from AppError', () => {
    const err = new TargetError('floppy', 'boom');
    expect(err).toBeInstanceOf(AppError);
    expect(err.backend).toBe('floppy');
    expect(err.message).toBe('boom');
    expect(err.name).toBe('TargetError');
  });

  it('TraktError stays a TargetError so existing catches keep working', () => {
    const err = new TraktError('boom');
    expect(err).toBeInstanceOf(TargetError);
    expect(err).toBeInstanceOf(AppError);
    expect(err.backend).toBe('trakt');
    expect(err.name).toBe('TraktError');
  });

  it('FloppyError and MdblistError set their own backend', () => {
    expect(new FloppyError('x').backend).toBe('floppy');
    expect(new MdblistError('x').backend).toBe('mdblist');
    expect(new FloppyError('x').name).toBe('FloppyError');
    expect(new MdblistError('x').name).toBe('MdblistError');
  });
});
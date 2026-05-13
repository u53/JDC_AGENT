import { describe, it, expect } from 'vitest'
import { classifyError, getMaxRetries, getRetryDelay } from '../src/retry.js'

describe('classifyError', () => {
  it('classifies 429 as rate_limit', () => {
    expect(classifyError({ status: 429 })).toBe('rate_limit')
  })
  it('classifies 529 as overloaded', () => {
    expect(classifyError({ status: 529 })).toBe('overloaded')
  })
  it('classifies 502/503/504 as gateway', () => {
    expect(classifyError({ status: 502 })).toBe('gateway')
    expect(classifyError({ status: 503 })).toBe('gateway')
    expect(classifyError({ status: 504 })).toBe('gateway')
  })
  it('classifies ECONNRESET as network', () => {
    expect(classifyError({ message: 'ECONNRESET' })).toBe('network')
  })
  it('classifies prompt_too_long', () => {
    expect(classifyError({ message: 'prompt is too long' })).toBe('prompt_too_long')
  })
  it('classifies 401 as non_retryable', () => {
    expect(classifyError({ status: 401 })).toBe('non_retryable')
  })
})

describe('getMaxRetries', () => {
  it('returns 5 for rate_limit', () => {
    expect(getMaxRetries('rate_limit')).toBe(5)
  })
  it('returns 0 for non_retryable', () => {
    expect(getMaxRetries('non_retryable')).toBe(0)
  })
})

describe('getRetryDelay', () => {
  it('returns 1000 for network errors', () => {
    expect(getRetryDelay(0, 'network')).toBe(1000)
  })
  it('uses exponential backoff for gateway', () => {
    const d0 = getRetryDelay(0, 'gateway')
    const d1 = getRetryDelay(1, 'gateway')
    expect(d0).toBeGreaterThanOrEqual(1000)
    expect(d0).toBeLessThan(1200)
    expect(d1).toBeGreaterThanOrEqual(2000)
    expect(d1).toBeLessThan(2400)
  })
  it('uses retry-after header for rate_limit', () => {
    const delay = getRetryDelay(0, 'rate_limit', { headers: { 'retry-after': '5' } })
    expect(delay).toBe(5000)
  })
})

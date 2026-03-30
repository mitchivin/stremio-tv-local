/**
 * fetch-utils.js – Resilient fetching utilities
 * 
 * Provides robust HTTP request handling with:
 * - Retry logic with exponential backoff
 * - Request timeouts
 * - Connection pooling
 */

'use strict';

const http = require('http');
const https = require('https');

// HTTP agents with connection pooling and keep-alive enabled
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

/**
 * Retry a fetch operation with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} opts - Configuration
 * @param {number} opts.maxRetries - Max retry attempts (default: 3)
 * @param {number} opts.initialDelay - Initial delay in ms (default: 500)
 * @param {number} opts.maxDelay - Max delay in ms (default: 5000)
 * @returns {Promise} Result from fn
 */
async function retryWithBackoff(fn, opts = {}) {
  const {
    maxRetries = 3,
    initialDelay = 500,
    maxDelay = 5000,
  } = opts;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      
      if (attempt === maxRetries) break;
      
      // Exponential backoff: 500ms, 1000ms, 2000ms, ...
      const delay = Math.min(
        initialDelay * Math.pow(2, attempt),
        maxDelay
      );
      
      console.error(
        `[retry] Attempt ${attempt + 1}/${maxRetries + 1} failed: ${err.message}. ` +
        `Retrying in ${delay}ms...`
      );
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(
    `Failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * Fetch with timeout support
 * @param {string} url - URL to fetch
 * @param {Object} opts - Fetch options + timeout
 * @param {number} opts.timeout - Timeout in ms (default: 5000)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, opts = {}) {
  const { timeout = 5000, ...fetchOpts } = opts;

  // Set correct agent based on URL protocol
  const isHttps = url.startsWith('https');
  if (!fetchOpts.agent) {
    fetchOpts.agent = isHttps ? httpsAgent : httpAgent;
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOpts,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw err;
  }
}

/**
 * Fetch with timeout AND retry logic
 * @param {string} url - URL to fetch
 * @param {Object} opts - Options
 * @param {number} opts.timeout - Request timeout in ms (default: 5000)
 * @param {number} opts.maxRetries - Retry attempts (default: 2)
 * @param {number} opts.retryDelay - Initial retry delay (default: 500)
 * Returns {Promise<Response>}
 */
async function fetchResilient(url, opts = {}) {
  const {
    timeout = 5000,
    maxRetries = 2,
    retryDelay = 500,
    ...fetchOpts
  } = opts;

  return retryWithBackoff(
    () => fetchWithTimeout(url, { timeout, ...fetchOpts }),
    {
      maxRetries,
      initialDelay: retryDelay,
      maxDelay: Math.max(timeout, 5000),
    }
  );
}

module.exports = {
  retryWithBackoff,
  fetchWithTimeout,
  fetchResilient,
  httpAgent,
  httpsAgent,
};

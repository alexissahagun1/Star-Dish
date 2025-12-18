import { SessionToken } from '@mapbox/search-js-core';

/**
 * Shared session token manager for Mapbox Search Box API.
 * Prevents multiple SearchHeader instances from creating separate sessions.
 * 
 * Session tokens are only created when actually calling the API (not for cached results).
 * Tokens are cleared after retrieve() or after 5 minutes of inactivity.
 */
class SessionTokenManager {
  private token: SessionToken | null = null;
  private lastUsedAt: number = 0;
  private readonly INACTIVITY_TIMEOUT_MS = 300_000; // 5 minutes

  /**
   * Get the current session token, or create a new one if needed.
   * Only creates a token when actually needed (not for cached results).
   */
  getToken(): SessionToken {
    const now = Date.now();
    
    // Check if token exists and is still valid (not expired due to inactivity)
    if (this.token && (now - this.lastUsedAt) < this.INACTIVITY_TIMEOUT_MS) {
      this.lastUsedAt = now;
      return this.token;
    }

    // Create new token
    this.token = new SessionToken();
    this.lastUsedAt = now;
    
    if (__DEV__) {
      console.log('[sessionTokenManager] Created new session token');
    }
    
    return this.token;
  }

  /**
   * Update the token (e.g., after suggest() returns a new token).
   * This is called when the API returns a session token.
   */
  updateToken(token: SessionToken) {
    this.token = token;
    this.lastUsedAt = Date.now();
  }

  /**
   * Clear the session token (e.g., after retrieve() is called).
   * This ensures we start a new session for the next search.
   */
  clearToken() {
    if (this.token) {
      if (__DEV__) {
        console.log('[sessionTokenManager] Cleared session token');
      }
      this.token = null;
      this.lastUsedAt = 0;
    }
  }

  /**
   * Check if we have an active token.
   */
  hasToken(): boolean {
    const now = Date.now();
    return this.token !== null && (now - this.lastUsedAt) < this.INACTIVITY_TIMEOUT_MS;
  }
}

// Singleton instance
export const sessionTokenManager = new SessionTokenManager();

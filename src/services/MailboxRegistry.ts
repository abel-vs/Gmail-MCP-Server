import { OAuth2Client } from 'google-auth-library';
import { google, gmail_v1 } from 'googleapis';
import { getCredentialsProjectId } from '../auth/utils.js';

/**
 * Represents a mailbox (Gmail account) with its metadata
 */
export interface MailboxInfo {
  accountId: string;
  email: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
}

/**
 * MailboxRegistry service for managing Gmail accounts.
 * Implemented as a singleton to ensure cache is shared across all handlers.
 */
export class MailboxRegistry {
  private static instance: MailboxRegistry | null = null;

  private cache: Map<string, { data: MailboxInfo[]; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Track in-flight requests to prevent duplicate API calls
  private inFlightRequests: Map<string, Promise<MailboxInfo[]>> = new Map();

  /**
   * Get the singleton instance of MailboxRegistry
   */
  static getInstance(): MailboxRegistry {
    if (!MailboxRegistry.instance) {
      MailboxRegistry.instance = new MailboxRegistry();
    }
    return MailboxRegistry.instance;
  }

  /**
   * Reset the singleton instance (useful for testing or when accounts change)
   */
  static resetInstance(): void {
    if (MailboxRegistry.instance) {
      MailboxRegistry.instance.clearCache();
    }
    MailboxRegistry.instance = null;
  }

  /**
   * Get Gmail client for a specific account
   */
  private getGmail(auth: OAuth2Client): gmail_v1.Gmail {
    const quotaProjectId = getCredentialsProjectId();
    const config: any = {
      version: 'v1',
      auth,
      timeout: 10000
    };
    if (quotaProjectId) {
      config.quotaProjectId = quotaProjectId;
    }
    return google.gmail(config);
  }

  /**
   * Fetch mailbox info from all accounts.
   * Uses in-flight request tracking to prevent duplicate API calls.
   */
  async getMailboxes(accounts: Map<string, OAuth2Client>): Promise<MailboxInfo[]> {
    const cacheKey = Array.from(accounts.keys()).sort().join(',');

    // Check if there's already an in-flight request
    const inFlight = this.inFlightRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // Create new request and track it
    const requestPromise = this.fetchMailboxes(accounts, cacheKey);
    this.inFlightRequests.set(cacheKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      this.inFlightRequests.delete(cacheKey);
    }
  }

  /**
   * Internal method to fetch mailbox info
   */
  private async fetchMailboxes(
    accounts: Map<string, OAuth2Client>,
    cacheKey: string
  ): Promise<MailboxInfo[]> {
    const mailboxes = await Promise.all(
      Array.from(accounts.entries()).map(async ([accountId, client]) => {
        try {
          const gmail = this.getGmail(client);
          const response = await gmail.users.getProfile({ userId: 'me' });
          
          return {
            accountId,
            email: response.data.emailAddress || 'unknown',
            messagesTotal: response.data.messagesTotal || undefined,
            threadsTotal: response.data.threadsTotal || undefined,
            historyId: response.data.historyId || undefined
          };
        } catch (error) {
          // If one account fails, return minimal info
          return {
            accountId,
            email: 'unknown'
          };
        }
      })
    );

    // Cache results
    this.cache.set(cacheKey, {
      data: mailboxes,
      timestamp: Date.now()
    });

    return mailboxes;
  }

  /**
   * Find an account by email address
   */
  async findAccountByEmail(
    email: string,
    accounts: Map<string, OAuth2Client>
  ): Promise<string | null> {
    const mailboxes = await this.getMailboxes(accounts);
    const lowerEmail = email.toLowerCase();
    
    const match = mailboxes.find(m => m.email.toLowerCase() === lowerEmail);
    return match?.accountId || null;
  }

  /**
   * Get the account for a specific message.
   * Since Gmail messages are account-specific, this searches across accounts.
   */
  async findAccountForMessage(
    messageId: string,
    accounts: Map<string, OAuth2Client>
  ): Promise<{ accountId: string; client: OAuth2Client } | null> {
    // For single account, just return it
    if (accounts.size === 1) {
      const entry = accounts.entries().next().value;
      if (entry) {
        const [accountId, client] = entry;
        return { accountId, client };
      }
    }

    // For multiple accounts, try to find the message in each
    for (const [accountId, client] of accounts) {
      try {
        const gmail = this.getGmail(client);
        await gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'minimal'
        });
        // Message found in this account
        return { accountId, client };
      } catch {
        // Message not found, try next account
        continue;
      }
    }

    return null;
  }

  /**
   * Get the best account for sending an email.
   * If a specific "from" email is provided, tries to match it.
   */
  async getAccountForSending(
    fromEmail: string | undefined,
    accounts: Map<string, OAuth2Client>
  ): Promise<{ accountId: string; client: OAuth2Client } | null> {
    // For single account, just return it
    if (accounts.size === 1) {
      const entry = accounts.entries().next().value;
      if (entry) {
        const [accountId, client] = entry;
        return { accountId, client };
      }
    }

    // If from email specified, try to match
    if (fromEmail) {
      const accountId = await this.findAccountByEmail(fromEmail, accounts);
      if (accountId) {
        const client = accounts.get(accountId);
        if (client) {
          return { accountId, client };
        }
      }
    }

    // No match - return null to force explicit account selection
    return null;
  }

  /**
   * Clear cache and in-flight requests
   */
  clearCache(): void {
    this.cache.clear();
    this.inFlightRequests.clear();
  }
}

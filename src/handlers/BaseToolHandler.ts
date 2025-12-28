import { CallToolResult, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { OAuth2Client } from 'google-auth-library';
import { GaxiosError } from 'gaxios';
import { google, gmail_v1 } from 'googleapis';
import { getCredentialsProjectId } from '../auth/utils.js';
import { MailboxRegistry } from '../services/MailboxRegistry.js';
import { validateAccountId } from '../auth/paths.js';

export abstract class BaseToolHandler<TArgs = any> {
  protected mailboxRegistry: MailboxRegistry = MailboxRegistry.getInstance();

  abstract runTool(args: TArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult>;

  /**
   * Normalize account ID to lowercase for case-insensitive matching
   */
  private normalizeAccountId(accountId: string): string {
    return accountId.toLowerCase();
  }

  /**
   * Get OAuth2Client for a specific account, or the first available account if none specified.
   * Use this for read-only operations where any authenticated account will work.
   */
  protected getClientForAccountOrFirst(
    accountId: string | undefined,
    accounts: Map<string, OAuth2Client>
  ): { client: OAuth2Client; accountId: string } {
    if (accounts.size === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'No authenticated accounts available. Please run authentication first using manage-accounts with action "add".'
      );
    }

    if (accountId) {
      const normalizedId = this.normalizeAccountId(accountId);
      try {
        validateAccountId(normalizedId);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          error instanceof Error ? error.message : 'Invalid account ID'
        );
      }

      const client = accounts.get(normalizedId);
      if (!client) {
        const availableAccounts = Array.from(accounts.keys()).join(', ');
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Account "${normalizedId}" not found. Available accounts: ${availableAccounts}`
        );
      }
      return { client, accountId: normalizedId };
    }

    // No account specified - use first available (sorted for consistency)
    const sortedAccountIds = Array.from(accounts.keys()).sort();
    const firstAccountId = sortedAccountIds[0];
    const client = accounts.get(firstAccountId);
    if (!client) {
      throw new McpError(ErrorCode.InternalError, 'Failed to retrieve OAuth client');
    }
    return { client, accountId: firstAccountId };
  }

  /**
   * Get OAuth2Client for a specific account or determine default account.
   * For write operations, requires explicit account selection when multiple accounts exist.
   */
  protected getClientForAccount(
    accountId: string | undefined,
    accounts: Map<string, OAuth2Client>
  ): { client: OAuth2Client; accountId: string } {
    if (accounts.size === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'No authenticated accounts available. Please run authentication first using manage-accounts with action "add".'
      );
    }

    if (accountId) {
      const normalizedId = this.normalizeAccountId(accountId);
      try {
        validateAccountId(normalizedId);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          error instanceof Error ? error.message : 'Invalid account ID'
        );
      }

      const client = accounts.get(normalizedId);
      if (!client) {
        const availableAccounts = Array.from(accounts.keys()).join(', ');
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Account "${normalizedId}" not found. Available accounts: ${availableAccounts}`
        );
      }

      return { client, accountId: normalizedId };
    }

    // No account specified
    if (accounts.size === 1) {
      const entry = accounts.entries().next().value;
      if (entry) {
        const [accId, client] = entry;
        return { client, accountId: accId };
      }
    }

    // Multiple accounts but no account specified - error
    const availableAccounts = Array.from(accounts.keys()).join(', ');
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Multiple accounts available (${availableAccounts}). You must specify the 'account' parameter to indicate which account to use.`
    );
  }

  /**
   * Get multiple OAuth2Clients for multi-account operations (e.g., search across accounts)
   */
  protected getClientsForAccounts(
    accountIds: string | string[] | undefined,
    accounts: Map<string, OAuth2Client>
  ): Map<string, OAuth2Client> {
    if (accounts.size === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'No authenticated accounts available. Please run authentication first using manage-accounts with action "add".'
      );
    }

    const ids = this.normalizeAccountIds(accountIds);

    // If no specific accounts requested, use all available accounts
    if (ids.length === 0) {
      return accounts;
    }

    // Validate and retrieve specified accounts
    const result = new Map<string, OAuth2Client>();

    for (const id of ids) {
      const normalizedId = this.normalizeAccountId(id);

      try {
        validateAccountId(normalizedId);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          error instanceof Error ? error.message : 'Invalid account ID'
        );
      }

      const client = accounts.get(normalizedId);
      if (!client) {
        const availableAccounts = Array.from(accounts.keys()).join(', ');
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Account "${normalizedId}" not found. Available accounts: ${availableAccounts}`
        );
      }

      result.set(normalizedId, client);
    }

    return result;
  }

  /**
   * Normalize account parameter to array of account IDs
   */
  protected normalizeAccountIds(accountIds: string | string[] | undefined): string[] {
    if (!accountIds) {
      return [];
    }
    return Array.isArray(accountIds) ? accountIds : [accountIds];
  }

  /**
   * Handle Google API errors with appropriate MCP error codes
   */
  protected handleGoogleApiError(error: unknown): never {
    if (error instanceof GaxiosError) {
      const status = error.response?.status;
      const errorData = error.response?.data;

      if (errorData?.error === 'invalid_grant') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Authentication token is invalid or expired. Please re-run authentication using manage-accounts with action "add".'
        );
      }

      if (status === 400) {
        const errorMessage = errorData?.error?.message;
        const errorDetails = errorData?.error?.errors?.map((e: any) =>
          `${e.message || e.reason}${e.location ? ` (${e.location})` : ''}`
        ).join('; ');

        let fullMessage: string;
        if (errorDetails) {
          fullMessage = `Bad Request: ${errorMessage || 'Invalid request parameters'}. Details: ${errorDetails}`;
        } else if (errorMessage) {
          fullMessage = `Bad Request: ${errorMessage}`;
        } else {
          const errorStr = JSON.stringify(errorData, null, 2);
          fullMessage = `Bad Request: Invalid request parameters. Raw error: ${errorStr}`;
        }

        throw new McpError(ErrorCode.InvalidRequest, fullMessage);
      }

      if (status === 401) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Authentication required. Please authenticate using manage-accounts with action "add".'
        );
      }

      if (status === 403) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Access denied: ${errorData?.error?.message || 'Insufficient permissions'}`
        );
      }

      if (status === 404) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Resource not found: ${errorData?.error?.message || 'The requested email or resource does not exist'}`
        );
      }

      if (status === 429) {
        throw new McpError(
          ErrorCode.InternalError,
          `Rate limit exceeded. Please try again later. ${errorData?.error?.message || ''}`
        );
      }

      if (status && status >= 500) {
        throw new McpError(
          ErrorCode.InternalError,
          `Google API server error: ${errorData?.error?.message || error.message}`
        );
      }

      const errorMessage = errorData?.error?.message || error.message;
      throw new McpError(ErrorCode.InvalidRequest, `Google API error: ${errorMessage}`);
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `Internal error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'An unknown error occurred');
  }

  /**
   * Get Gmail API client for an OAuth2Client
   */
  protected getGmail(auth: OAuth2Client): gmail_v1.Gmail {
    const quotaProjectId = getCredentialsProjectId();

    const config: any = {
      version: 'v1',
      auth,
      timeout: 30000
    };

    if (quotaProjectId) {
      config.quotaProjectId = quotaProjectId;
    }

    return google.gmail(config);
  }

  /**
   * Find which account has a specific message
   */
  protected async findAccountForMessage(
    messageId: string,
    accounts: Map<string, OAuth2Client>
  ): Promise<{ accountId: string; client: OAuth2Client } | null> {
    return this.mailboxRegistry.findAccountForMessage(messageId, accounts);
  }

  /**
   * Timeout wrapper for async operations
   */
  protected async withTimeout<T>(promise: Promise<T>, timeoutMs: number = 30000): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }
}

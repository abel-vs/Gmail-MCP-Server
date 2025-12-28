import { OAuth2Client, Credentials } from 'google-auth-library';
import fs from 'fs/promises';
import { getSecureTokenPath, getAccountMode, getLegacyTokenPath } from './utils.js';
import { GaxiosError } from 'gaxios';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { validateAccountId } from './paths.js';

// Extended credentials with cached email
interface CachedCredentials extends Credentials {
  cached_email?: string;
}

// Interface for multi-account token storage
interface MultiAccountTokens {
  [accountId: string]: CachedCredentials;
}

export class TokenManager {
  private oauth2Client: OAuth2Client;
  private tokenPath: string;
  private accountMode: string;
  private accounts: Map<string, OAuth2Client> = new Map();
  private credentials: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(oauth2Client: OAuth2Client) {
    this.oauth2Client = oauth2Client;
    this.tokenPath = getSecureTokenPath();
    this.accountMode = getAccountMode();

    // Store credentials to avoid accessing private properties later
    this.credentials = {
      clientId: (oauth2Client as any)._clientId,
      clientSecret: (oauth2Client as any)._clientSecret,
      redirectUri: (oauth2Client as any)._redirectUri
    };

    this.setupTokenRefresh();
  }

  // Method to expose the token path
  public getTokenPath(): string {
    return this.tokenPath;
  }

  // Method to get current account mode
  public getAccountMode(): string {
    return this.accountMode;
  }

  // Method to switch account mode
  public setAccountMode(mode: string): void {
    this.accountMode = mode;
  }

  private async ensureTokenDirectoryExists(): Promise<void> {
    try {
      await mkdir(dirname(this.tokenPath), { recursive: true });
    } catch (error) {
      process.stderr.write(`Failed to create token directory: ${error}\n`);
    }
  }

  private async loadMultiAccountTokens(): Promise<MultiAccountTokens> {
    try {
      const fileContent = await fs.readFile(this.tokenPath, 'utf-8');
      const parsed = JSON.parse(fileContent);

      // Check if this is the old single-account format
      if (parsed.access_token || parsed.refresh_token) {
        // Convert old format to new multi-account format
        const multiAccountTokens: MultiAccountTokens = {
          normal: parsed
        };
        await this.saveMultiAccountTokens(multiAccountTokens);
        return multiAccountTokens;
      }

      // Already in multi-account format
      return parsed as MultiAccountTokens;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
        // File doesn't exist, return empty structure
        return {};
      }
      throw error;
    }
  }

  /**
   * Raw token file read without migration logic.
   * Used for atomic read-modify-write operations.
   */
  private async loadMultiAccountTokensRaw(): Promise<MultiAccountTokens> {
    try {
      const fileContent = await fs.readFile(this.tokenPath, 'utf-8');
      return JSON.parse(fileContent) as MultiAccountTokens;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async saveMultiAccountTokens(multiAccountTokens: MultiAccountTokens): Promise<void> {
    return this.enqueueTokenWrite(async () => {
      await this.ensureTokenDirectoryExists();
      await fs.writeFile(this.tokenPath, JSON.stringify(multiAccountTokens, null, 2), {
        mode: 0o600,
      });
    });
  }

  private enqueueTokenWrite(operation: () => Promise<void>): Promise<void> {
    const pendingWrite = this.writeQueue
      .catch(() => undefined)
      .then(operation);

    this.writeQueue = pendingWrite
      .catch(error => {
        process.stderr.write(`Error writing token file: ${error instanceof Error ? error.message : error}\n`);
        throw error;
      })
      .catch(() => undefined);

    return pendingWrite;
  }

  private setupTokenRefresh(): void {
    this.setupTokenRefreshForAccount(this.oauth2Client, this.accountMode);
  }

  /**
   * Set up token refresh handler for a specific account
   */
  private setupTokenRefreshForAccount(client: OAuth2Client, accountId: string): void {
    client.on('tokens', async (newTokens) => {
      try {
        await this.enqueueTokenWrite(async () => {
          const multiAccountTokens = await this.loadMultiAccountTokens();
          const currentTokens = multiAccountTokens[accountId] || {};

          const updatedTokens = {
            ...currentTokens,
            ...newTokens,
            refresh_token: newTokens.refresh_token || currentTokens.refresh_token,
          };

          multiAccountTokens[accountId] = updatedTokens;
          await this.ensureTokenDirectoryExists();
          await fs.writeFile(this.tokenPath, JSON.stringify(multiAccountTokens, null, 2), {
            mode: 0o600,
          });
        });

        if (process.env.NODE_ENV !== 'test') {
          process.stderr.write(`Tokens updated and saved for ${accountId} account\n`);
        }
      } catch (error: unknown) {
        process.stderr.write('Error saving updated tokens: ');
        if (error instanceof Error) {
          process.stderr.write(error.message);
        } else if (typeof error === 'string') {
          process.stderr.write(error);
        }
        process.stderr.write('\n');
      }
    });
  }

  private async migrateLegacyTokens(): Promise<boolean> {
    const legacyPath = getLegacyTokenPath();
    try {
      // Check if legacy tokens exist
      const legacyExists = await fs.access(legacyPath).then(() => true).catch(() => false);
      if (!legacyExists) {
        return false;
      }

      // Read legacy tokens
      const legacyTokens = JSON.parse(await fs.readFile(legacyPath, 'utf-8'));
      
      if (!legacyTokens || typeof legacyTokens !== 'object') {
        process.stderr.write('Invalid legacy token format, skipping migration\n');
        return false;
      }

      // Ensure new token directory exists
      await this.ensureTokenDirectoryExists();
      
      // Convert to multi-account format if needed
      let tokensToSave: MultiAccountTokens;
      if (legacyTokens.access_token || legacyTokens.refresh_token) {
        // Single account format - wrap in multi-account structure
        tokensToSave = { normal: legacyTokens };
      } else {
        // Already multi-account format
        tokensToSave = legacyTokens;
      }
      
      // Save to new location
      await fs.writeFile(this.tokenPath, JSON.stringify(tokensToSave, null, 2), {
        mode: 0o600,
      });
      
      process.stderr.write(`Migrated tokens from legacy location: ${legacyPath} to: ${this.tokenPath}\n`);
      
      return true;
    } catch (error) {
      process.stderr.write(`Error migrating legacy tokens: ${error}\n`);
      return false;
    }
  }

  async loadSavedTokens(): Promise<boolean> {
    try {
      await this.ensureTokenDirectoryExists();
      
      // Check if current token file exists
      const tokenExists = await fs.access(this.tokenPath).then(() => true).catch(() => false);
      
      // If no current tokens, try to migrate from legacy location
      if (!tokenExists) {
        const migrated = await this.migrateLegacyTokens();
        if (!migrated) {
          process.stderr.write(`No token file found at: ${this.tokenPath}\n`);
          return false;
        }
      }

      const multiAccountTokens = await this.loadMultiAccountTokens();
      const tokens = multiAccountTokens[this.accountMode];

      if (!tokens || typeof tokens !== 'object') {
        process.stderr.write(`No tokens found for ${this.accountMode} account in file: ${this.tokenPath}\n`);
        return false;
      }

      this.oauth2Client.setCredentials(tokens);
      process.stderr.write(`Loaded tokens for ${this.accountMode} account\n`);
      return true;
    } catch (error: unknown) {
      process.stderr.write(`Error loading tokens for ${this.accountMode} account: `);
      if (error instanceof Error && 'code' in error && (error as any).code !== 'ENOENT') { 
        try { 
          await fs.unlink(this.tokenPath); 
          process.stderr.write('Removed potentially corrupted token file\n'); 
        } catch { /* ignore */ } 
      }
      return false;
    }
  }

  async refreshTokensIfNeeded(): Promise<boolean> {
    const expiryDate = this.oauth2Client.credentials.expiry_date;
    const isExpired = expiryDate
      ? Date.now() >= expiryDate - 5 * 60 * 1000 // 5 minute buffer
      : !this.oauth2Client.credentials.access_token;

    if (isExpired && this.oauth2Client.credentials.refresh_token) {
      if (process.env.NODE_ENV !== 'test') {
        process.stderr.write(`Auth token expired or nearing expiry for ${this.accountMode} account, refreshing...\n`);
      }
      try {
        const response = await this.oauth2Client.refreshAccessToken();
        const newTokens = response.credentials;

        if (!newTokens.access_token) {
          throw new Error('Received invalid tokens during refresh');
        }
        this.oauth2Client.setCredentials(newTokens);
        if (process.env.NODE_ENV !== 'test') {
          process.stderr.write(`Token refreshed successfully for ${this.accountMode} account\n`);
        }
        return true;
      } catch (refreshError) {
        if (refreshError instanceof GaxiosError && refreshError.response?.data?.error === 'invalid_grant') {
          process.stderr.write(`Error refreshing auth token for ${this.accountMode} account: Invalid grant. Token likely expired or revoked. Please re-authenticate.\n`);
          return false;
        } else {
          process.stderr.write(`Error refreshing auth token for ${this.accountMode} account: `);
          if (refreshError instanceof Error) {
            process.stderr.write(refreshError.message);
          } else if (typeof refreshError === 'string') {
            process.stderr.write(refreshError);
          }
          process.stderr.write('\n');
          return false;
        }
      }
    } else if (!this.oauth2Client.credentials.access_token && !this.oauth2Client.credentials.refresh_token) {
      process.stderr.write(`No access or refresh token available for ${this.accountMode} account. Please re-authenticate.\n`);
      return false;
    } else {
      return true;
    }
  }

  async validateTokens(accountMode?: string): Promise<boolean> {
    const modeToValidate = accountMode || this.accountMode;
    const currentMode = this.accountMode;
    
    try {
      if (modeToValidate !== currentMode) {
        this.accountMode = modeToValidate;
      }
      
      if (!this.oauth2Client.credentials || !this.oauth2Client.credentials.access_token) {
        if (!(await this.loadSavedTokens())) {
          return false;
        }
        if (!this.oauth2Client.credentials || !this.oauth2Client.credentials.access_token) {
          return false;
        }
      }
      
      const result = await this.refreshTokensIfNeeded();
      return result;
    } finally {
      if (modeToValidate !== currentMode) {
        this.accountMode = currentMode;
      }
    }
  }

  async saveTokens(tokens: Credentials, email?: string): Promise<void> {
    try {
      await this.enqueueTokenWrite(async () => {
        const multiAccountTokens = await this.loadMultiAccountTokens();
        const cachedTokens: CachedCredentials = { ...tokens };

        if (email) {
          cachedTokens.cached_email = email;
        }

        multiAccountTokens[this.accountMode] = cachedTokens;

        await this.ensureTokenDirectoryExists();
        await fs.writeFile(this.tokenPath, JSON.stringify(multiAccountTokens, null, 2), {
          mode: 0o600,
        });
      });
      this.oauth2Client.setCredentials(tokens);
      process.stderr.write(`Tokens saved successfully for ${this.accountMode} account to: ${this.tokenPath}\n`);
    } catch (error: unknown) {
      process.stderr.write(`Error saving tokens for ${this.accountMode} account: ${error}\n`);
      throw error;
    }
  }

  async clearTokens(): Promise<void> {
    try {
      this.oauth2Client.setCredentials({});

      await this.enqueueTokenWrite(async () => {
        const multiAccountTokens = await this.loadMultiAccountTokens();
        delete multiAccountTokens[this.accountMode];

        if (Object.keys(multiAccountTokens).length === 0) {
          await fs.unlink(this.tokenPath);
          process.stderr.write('All tokens cleared, file deleted\n');
        } else {
          await this.ensureTokenDirectoryExists();
          await fs.writeFile(this.tokenPath, JSON.stringify(multiAccountTokens, null, 2), {
            mode: 0o600,
          });
          process.stderr.write(`Tokens cleared for ${this.accountMode} account\n`);
        }
      });
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
        process.stderr.write('Token file already deleted\n');
      } else {
        process.stderr.write(`Error clearing tokens for ${this.accountMode} account: ${error}\n`);
      }
    }
  }

  // Method to list available accounts
  async listAvailableAccounts(): Promise<string[]> {
    try {
      const multiAccountTokens = await this.loadMultiAccountTokens();
      return Object.keys(multiAccountTokens);
    } catch (error) {
      return [];
    }
  }

  /**
   * Remove a specific account's tokens from storage.
   */
  async removeAccount(accountId: string): Promise<void> {
    const normalizedId = accountId.toLowerCase();

    await this.enqueueTokenWrite(async () => {
      const multiAccountTokens = await this.loadMultiAccountTokens();

      if (!multiAccountTokens[normalizedId]) {
        throw new Error(`Account "${normalizedId}" not found`);
      }

      delete multiAccountTokens[normalizedId];

      if (Object.keys(multiAccountTokens).length === 0) {
        await fs.unlink(this.tokenPath);
        process.stderr.write('All tokens cleared, file deleted\n');
      } else {
        await this.ensureTokenDirectoryExists();
        await fs.writeFile(this.tokenPath, JSON.stringify(multiAccountTokens, null, 2), {
          mode: 0o600,
        });
        process.stderr.write(`Account "${normalizedId}" removed successfully\n`);
      }

      this.accounts.delete(normalizedId);
    });
  }

  // Method to switch to a different account
  async switchAccount(newMode: string): Promise<boolean> {
    this.accountMode = newMode;
    return this.loadSavedTokens();
  }

  /**
   * Load all authenticated accounts from token file
   * Returns a Map of account ID to OAuth2Client
   */
  async loadAllAccounts(): Promise<Map<string, OAuth2Client>> {
    try {
      const multiAccountTokens = await this.loadMultiAccountTokens();

      // Remove accounts that no longer exist in token file
      for (const accountId of this.accounts.keys()) {
        if (!multiAccountTokens[accountId]) {
          const client = this.accounts.get(accountId);
          if (client) {
            client.removeAllListeners('tokens');
          }
          this.accounts.delete(accountId);
        }
      }

      // Add or update accounts
      for (const [accountId, tokens] of Object.entries(multiAccountTokens)) {
        try {
          validateAccountId(accountId);

          if (!tokens || typeof tokens !== 'object' || !tokens.access_token) {
            continue;
          }

          let client = this.accounts.get(accountId);

          if (!client) {
            client = new OAuth2Client(
              this.credentials.clientId,
              this.credentials.clientSecret,
              this.credentials.redirectUri
            );

            this.setupTokenRefreshForAccount(client, accountId);
            this.accounts.set(accountId, client);
          }

          client.setCredentials(tokens);

        } catch (error) {
          if (process.env.NODE_ENV !== 'test') {
            process.stderr.write(`Skipping invalid account "${accountId}": ${error}\n`);
          }
          continue;
        }
      }

      return this.accounts;
    } catch (error: any) {
      if (error && error.code === 'ENOENT') {
        return new Map();
      }
      throw error;
    }
  }

  /**
   * Get OAuth2Client for a specific account
   */
  getClient(accountId: string): OAuth2Client {
    validateAccountId(accountId);

    const client = this.accounts.get(accountId);
    if (!client) {
      throw new Error(`Account "${accountId}" not found. Please authenticate this account first.`);
    }

    return client;
  }

  /**
   * List all authenticated accounts with their email addresses and status
   */
  async listAccounts(): Promise<Array<{
    id: string;
    email: string;
    status: string;
  }>> {
    try {
      const multiAccountTokens = await this.loadMultiAccountTokens();
      const accountList: Array<{
        id: string;
        email: string;
        status: string;
      }> = [];
      let tokensUpdated = false;

      for (const [accountId, tokens] of Object.entries(multiAccountTokens)) {
        if (!tokens || typeof tokens !== 'object') {
          continue;
        }

        let client: OAuth2Client | null = null;

        if (tokens.access_token || tokens.refresh_token) {
          try {
            client = new OAuth2Client(
              this.credentials.clientId,
              this.credentials.clientSecret,
              this.credentials.redirectUri
            );
            client.setCredentials(tokens);

            // Try to refresh token if access token is expired or missing
            if (tokens.refresh_token && (!tokens.access_token || (tokens.expiry_date && tokens.expiry_date < Date.now()))) {
              try {
                const response = await client.refreshAccessToken();
                client.setCredentials(response.credentials);
                Object.assign(tokens, response.credentials);
                tokensUpdated = true;
              } catch {
                // Refresh failed
              }
            }
          } catch {
            client = null;
          }
        }

        // Get email address - use cached value if available
        let email = tokens.cached_email || 'unknown';
        if (!tokens.cached_email && client) {
          try {
            email = await this.getUserEmail(client);
            if (email !== 'unknown') {
              tokens.cached_email = email;
              tokensUpdated = true;
            }
          } catch {
            // Email retrieval failed
          }
        }

        // Determine status
        let status = 'active';
        if (!tokens.refresh_token) {
          if (!tokens.access_token || (tokens.expiry_date && tokens.expiry_date < Date.now())) {
            status = 'expired';
          }
        }

        accountList.push({ id: accountId, email, status });
      }

      // Save updated tokens with cached data
      if (tokensUpdated) {
        await this.enqueueTokenWrite(async () => {
          const latestTokens = await this.loadMultiAccountTokensRaw();

          for (const accountId of Object.keys(multiAccountTokens)) {
            const localUpdates = multiAccountTokens[accountId];
            const latestAccount = latestTokens[accountId];

            if (latestAccount && localUpdates) {
              if (localUpdates.cached_email) {
                latestAccount.cached_email = localUpdates.cached_email;
              }
            }
          }

          await this.ensureTokenDirectoryExists();
          await fs.writeFile(this.tokenPath, JSON.stringify(latestTokens, null, 2), {
            mode: 0o600,
          });
        });
      }

      return accountList;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get user email address from OAuth2Client
   */
  private async getUserEmail(client: OAuth2Client): Promise<string> {
    try {
      const tokenInfo = await client.getTokenInfo(client.credentials.access_token || '');
      if (tokenInfo.email) {
        return tokenInfo.email;
      }
    } catch {
      // Token info failed
    }

    // Fallback: Get profile info via Gmail API
    try {
      const { google } = await import('googleapis');
      const gmail = google.gmail({ version: 'v1', auth: client });
      const response = await gmail.users.getProfile({ userId: 'me' });
      if (response.data.emailAddress) {
        return response.data.emailAddress;
      }
    } catch {
      // Gmail fallback also failed
    }

    return 'unknown';
  }
}

import http from 'http';
import { OAuth2Client } from 'google-auth-library';
import { TokenManager } from './tokenManager.js';
import { loadCredentials } from './client.js';
import open from 'open';

// Gmail API scopes
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://mail.google.com/'
];

interface AuthStartResult {
  success: boolean;
  authUrl?: string;
  callbackUrl?: string;
  error?: string;
}

export class AuthServer {
  private server: http.Server | null = null;
  private tokenManager: TokenManager;
  private oauth2Client: OAuth2Client;
  private port: number;
  private authTimeout: NodeJS.Timeout | null = null;

  constructor(oauth2Client: OAuth2Client, tokenManager: TokenManager, port: number = 3000) {
    this.oauth2Client = oauth2Client;
    this.tokenManager = tokenManager;
    this.port = port;
  }

  /**
   * Start the authentication server for an MCP tool call.
   * Returns the auth URL for the user to visit.
   */
  async startForMcpTool(accountId: string): Promise<AuthStartResult> {
    // Check if server is already running
    if (this.server) {
      return {
        success: false,
        error: 'Authentication server is already running. Please complete the current authentication or wait for it to timeout.'
      };
    }

    try {
      const credentials = await loadCredentials();
      
      // Create a new OAuth client with the correct redirect URI
      const callbackUrl = `http://localhost:${this.port}/oauth2callback`;
      const authClient = new OAuth2Client(
        credentials.client_id,
        credentials.client_secret,
        callbackUrl
      );

      // Generate the authorization URL
      const authUrl = authClient.generateAuthUrl({
        access_type: 'offline',
        scope: GMAIL_SCOPES,
        prompt: 'consent', // Force consent to ensure we get a refresh token
      });

      // Start the callback server
      await this.startCallbackServer(authClient, accountId);

      return {
        success: true,
        authUrl,
        callbackUrl
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start authentication'
      };
    }
  }

  /**
   * Start the callback server to receive the OAuth code
   */
  private async startCallbackServer(authClient: OAuth2Client, accountId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        if (!req.url?.startsWith('/oauth2callback')) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const url = new URL(req.url, `http://localhost:${this.port}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Failed</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>❌ Authentication Failed</h1>
              <p>Error: ${error}</p>
              <p>You can close this window.</p>
            </body>
            </html>
          `);
          this.cleanup();
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Failed</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>❌ Authentication Failed</h1>
              <p>No authorization code received.</p>
              <p>You can close this window.</p>
            </body>
            </html>
          `);
          this.cleanup();
          return;
        }

        try {
          // Exchange the code for tokens
          const { tokens } = await authClient.getToken(code);
          
          // Set account mode and save tokens
          this.tokenManager.setAccountMode(accountId);
          
          // Get user email for caching
          authClient.setCredentials(tokens);
          let email: string | undefined;
          try {
            const tokenInfo = await authClient.getTokenInfo(tokens.access_token || '');
            email = tokenInfo.email || undefined;
          } catch {
            // Email retrieval failed, continue without it
          }

          await this.tokenManager.saveTokens(tokens, email);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Successful</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>✅ Authentication Successful!</h1>
              <p>Account <strong>"${accountId}"</strong> has been connected.</p>
              ${email ? `<p>Email: ${email}</p>` : ''}
              <p>You can close this window and return to your application.</p>
            </body>
            </html>
          `);

          process.stderr.write(`Successfully authenticated account "${accountId}"${email ? ` (${email})` : ''}\n`);
        } catch (tokenError) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Failed</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>❌ Authentication Failed</h1>
              <p>Failed to exchange authorization code for tokens.</p>
              <p>Error: ${tokenError instanceof Error ? tokenError.message : 'Unknown error'}</p>
              <p>You can close this window.</p>
            </body>
            </html>
          `);
          process.stderr.write(`Failed to authenticate account "${accountId}": ${tokenError}\n`);
        }

        this.cleanup();
      });

      this.server.listen(this.port, () => {
        process.stderr.write(`Auth callback server listening on port ${this.port}\n`);
        resolve();
      });

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use. Please try again later or use a different port.`));
        } else {
          reject(err);
        }
      });

      // Set a timeout to auto-close the server after 5 minutes
      this.authTimeout = setTimeout(() => {
        process.stderr.write('Authentication timeout - closing callback server\n');
        this.cleanup();
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Run interactive authentication (for CLI usage)
   */
  async authenticate(accountId?: string): Promise<void> {
    const targetAccount = accountId || this.tokenManager.getAccountMode();
    
    const result = await this.startForMcpTool(targetAccount);
    
    if (!result.success) {
      throw new Error(result.error);
    }

    console.log('Please visit this URL to authenticate:', result.authUrl);
    
    // Try to open the browser automatically
    try {
      await open(result.authUrl!);
    } catch {
      // Browser open failed, user will need to copy URL manually
    }

    // Wait for authentication to complete (server will handle cleanup)
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.server) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
    });
  }

  /**
   * Clean up the server and timeout
   */
  private cleanup(): void {
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }
    
    if (this.server) {
      this.server.close(() => {
        process.stderr.write('Auth callback server closed\n');
      });
      this.server = null;
    }
  }

  /**
   * Check if the server is currently running
   */
  isRunning(): boolean {
    return this.server !== null;
  }

  /**
   * Force stop the server
   */
  stop(): void {
    this.cleanup();
  }
}

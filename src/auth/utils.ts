import path from 'path';
import { homedir } from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSecureTokenPath, getLegacyTokenPath, getAccountMode } from './paths.js';

// Re-export path utilities for convenience
export { getSecureTokenPath, getLegacyTokenPath, getAccountMode };

// Helper to get the project root directory reliably
function getProjectRoot(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // In build output (e.g., dist/auth/utils.js), __dirname is .../dist/auth
  // Go up TWO levels to get the project root
  const projectRoot = path.join(__dirname, '..', '..');
  return path.resolve(projectRoot);
}

// Interface for OAuth credentials
export interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

// Interface for credentials file with project_id
export interface OAuthCredentialsWithProject {
  installed?: {
    project_id?: string;
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
  web?: {
    project_id?: string;
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
  project_id?: string;
  client_id?: string;
  client_secret?: string;
  redirect_uris?: string[];
}

/**
 * Returns the absolute path for the GCP OAuth keys file with priority:
 * 1. Environment variable GMAIL_OAUTH_PATH (highest priority)
 * 2. ~/.gmail-mcp/gcp-oauth.keys.json (user config directory)
 * 3. Project root gcp-oauth.keys.json (lowest priority)
 */
export function getKeysFilePath(): string {
  // Priority 1: Environment variable
  const envCredentialsPath = process.env.GMAIL_OAUTH_PATH;
  if (envCredentialsPath) {
    return path.resolve(envCredentialsPath);
  }

  // Priority 2: User config directory
  const configDir = path.join(homedir(), '.gmail-mcp');
  const configPath = path.join(configDir, 'gcp-oauth.keys.json');
  if (fs.existsSync(configPath)) {
    return configPath;
  }

  // Priority 3: Project root
  const projectRoot = getProjectRoot();
  const keysPath = path.join(projectRoot, 'gcp-oauth.keys.json');
  return keysPath;
}

/**
 * Helper to determine if we're currently in test mode
 */
export function isTestMode(): boolean {
  return getAccountMode() === 'test';
}

/**
 * Get project ID from OAuth credentials file
 * Returns undefined if credentials file doesn't exist, is invalid, or missing project_id
 */
export function getCredentialsProjectId(): string | undefined {
  try {
    const credentialsPath = getKeysFilePath();

    if (!fs.existsSync(credentialsPath)) {
      return undefined;
    }

    const credentialsContent = fs.readFileSync(credentialsPath, 'utf-8');
    const credentials: OAuthCredentialsWithProject = JSON.parse(credentialsContent);

    // Extract project_id from installed/web format or direct format
    if (credentials.installed?.project_id) {
      return credentials.installed.project_id;
    } else if (credentials.web?.project_id) {
      return credentials.web.project_id;
    } else if (credentials.project_id) {
      return credentials.project_id;
    }

    return undefined;
  } catch (error) {
    // If we can't read project ID, return undefined (backward compatibility)
    return undefined;
  }
}

/**
 * Generate helpful error message for missing credentials
 */
export function generateCredentialsErrorMessage(): string {
  return `
OAuth credentials not found. Please provide credentials using one of these methods:

1. Environment variable:
   Set GMAIL_OAUTH_PATH to the path of your credentials file:
   export GMAIL_OAUTH_PATH="/path/to/gcp-oauth.keys.json"

2. User config directory:
   Place your gcp-oauth.keys.json file in ~/.gmail-mcp/

3. Project directory:
   Place your gcp-oauth.keys.json file in the project root.

Token storage:
- Tokens are saved to: ${getSecureTokenPath()}
- To use a custom token location, set GMAIL_MCP_TOKEN_PATH environment variable

To get OAuth credentials:
1. Go to the Google Cloud Console (https://console.cloud.google.com/)
2. Create or select a project
3. Enable the Gmail API
4. Create OAuth 2.0 credentials
5. Download the credentials file as gcp-oauth.keys.json
`.trim();
}

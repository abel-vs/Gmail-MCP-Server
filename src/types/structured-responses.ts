/**
 * Structured response types for Gmail MCP Server
 * These types ensure consistent response formats across all handlers
 */

// ============ Account Types ============

export interface AccountInfo {
  account_id: string;
  status: 'active' | 'expired' | 'invalid' | 'error';
  email?: string;
  error?: string;
}

export interface AccountStatusResponse {
  accounts: AccountInfo[];
  total_accounts: number;
  message: string;
}

export interface AddAccountResponse {
  status: 'awaiting_authentication' | 'already_authenticated';
  account_id: string;
  auth_url?: string;
  callback_url?: string;
  instructions?: string;
  expires_in_minutes?: number;
  message?: string;
  next_step?: string;
}

export interface RemoveAccountResponse {
  success: boolean;
  account_id: string;
  message: string;
  remaining_accounts: string[];
}

// ============ Email Types ============

export interface EmailHeader {
  name: string;
  value: string;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface StructuredEmail {
  id: string;
  threadId: string;
  accountId?: string;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  date: string;
  snippet?: string;
  body?: {
    text?: string;
    html?: string;
  };
  labels?: string[];
  attachments?: EmailAttachment[];
}

export interface ReadEmailResponse {
  email: StructuredEmail;
  accountId?: string;
}

export interface SearchEmailsResponse {
  emails: StructuredEmail[];
  totalCount: number;
  query: string;
  accountId?: string;
  accounts?: string[];
  note?: string;
}

export interface SendEmailResponse {
  success: boolean;
  messageId: string;
  threadId?: string;
  accountId?: string;
  message: string;
}

export interface DraftEmailResponse {
  success: boolean;
  draftId: string;
  messageId?: string;
  accountId?: string;
  message: string;
}

export interface ModifyEmailResponse {
  success: boolean;
  messageId: string;
  accountId?: string;
  addedLabels?: string[];
  removedLabels?: string[];
  message: string;
}

export interface DeleteEmailResponse {
  success: boolean;
  messageId: string;
  accountId?: string;
  message: string;
}

// ============ Batch Operation Types ============

export interface BatchOperationResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  failures?: Array<{
    id: string;
    error: string;
  }>;
  accountId?: string;
  message: string;
}

// ============ Label Types ============

export interface LabelInfo {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageListVisibility?: string;
  labelListVisibility?: string;
  messagesTotal?: number;
  messagesUnread?: number;
}

export interface ListLabelsResponse {
  labels: LabelInfo[];
  systemCount: number;
  userCount: number;
  totalCount: number;
  accountId?: string;
}

export interface LabelOperationResponse {
  success: boolean;
  label: LabelInfo;
  accountId?: string;
  message: string;
}

// ============ Filter Types ============

export interface FilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  excludeChats?: boolean;
  size?: number;
  sizeComparison?: 'unspecified' | 'smaller' | 'larger';
}

export interface FilterAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
}

export interface FilterInfo {
  id: string;
  criteria: FilterCriteria;
  action: FilterAction;
}

export interface ListFiltersResponse {
  filters: FilterInfo[];
  count: number;
  accountId?: string;
}

export interface FilterOperationResponse {
  success: boolean;
  filter: FilterInfo;
  accountId?: string;
  message: string;
}

// ============ Attachment Types ============

export interface DownloadAttachmentResponse {
  success: boolean;
  filename: string;
  size: number;
  savedTo: string;
  accountId?: string;
  message: string;
}

// ============ Helper Functions ============

/**
 * Create a structured JSON response for MCP tools
 */
export function createStructuredResponse<T>(data: T): { content: Array<{ type: string; text: string }> } {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(data, null, 2)
    }]
  };
}

/**
 * Create a text response for MCP tools
 */
export function createTextResponse(text: string): { content: Array<{ type: string; text: string }> } {
  return {
    content: [{
      type: 'text',
      text
    }]
  };
}

/**
 * Create an error response for MCP tools
 */
export function createErrorResponse(error: string | Error): { content: Array<{ type: string; text: string }> } {
  const message = error instanceof Error ? error.message : error;
  return {
    content: [{
      type: 'text',
      text: `Error: ${message}`
    }]
  };
}

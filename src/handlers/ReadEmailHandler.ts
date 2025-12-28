import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OAuth2Client } from 'google-auth-library';
import { BaseToolHandler } from './BaseToolHandler.js';
import { ReadEmailArgs } from '../schemas/types.js';
import { 
  ReadEmailResponse, 
  StructuredEmail, 
  EmailAttachment,
  createStructuredResponse 
} from '../types/structured-responses.js';

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
}

interface EmailContent {
  text: string;
  html: string;
}

export class ReadEmailHandler extends BaseToolHandler<ReadEmailArgs> {
  async runTool(args: ReadEmailArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    // Get accounts to search
    const selectedAccounts = this.getClientsForAccounts(args.account, accounts);
    
    // Try to find the message in the specified/available accounts
    let foundAccount: { accountId: string; client: OAuth2Client } | null = null;
    
    if (selectedAccounts.size === 1) {
      const [accountId, client] = selectedAccounts.entries().next().value!;
      foundAccount = { accountId, client };
    } else {
      // Search across accounts to find the message
      foundAccount = await this.findAccountForMessage(args.messageId, selectedAccounts);
    }

    if (!foundAccount) {
      const accountList = Array.from(selectedAccounts.keys()).join(', ');
      return createStructuredResponse({
        error: `Message not found in accounts: ${accountList}`,
        messageId: args.messageId
      });
    }

    const { client, accountId } = foundAccount;
    const gmail = this.getGmail(client);

    try {
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: args.messageId,
        format: 'full',
      });

      const headers = response.data.payload?.headers || [];
      const subject = this.getHeader(headers, 'subject');
      const from = this.getHeader(headers, 'from');
      const to = this.getHeader(headers, 'to');
      const cc = this.getHeader(headers, 'cc');
      const date = this.getHeader(headers, 'date');
      const threadId = response.data.threadId || '';

      // Extract email content
      const { text, html } = this.extractEmailContent(response.data.payload as GmailMessagePart || {});

      // Get attachment information
      const attachments = this.extractAttachments(response.data.payload as GmailMessagePart);

      const email: StructuredEmail = {
        id: args.messageId,
        threadId,
        accountId,
        subject,
        from,
        to,
        cc: cc || undefined,
        date,
        snippet: response.data.snippet || undefined,
        body: {
          text: text || undefined,
          html: html || undefined
        },
        labels: response.data.labelIds || undefined,
        attachments: attachments.length > 0 ? attachments : undefined
      };

      const result: ReadEmailResponse = {
        email,
        accountId
      };

      return createStructuredResponse(result);
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }

  private getHeader(headers: Array<{ name?: string | null; value?: string | null }>, name: string): string {
    const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
    return header?.value || '';
  }

  private extractEmailContent(messagePart: GmailMessagePart): EmailContent {
    let textContent = '';
    let htmlContent = '';

    if (messagePart.body && messagePart.body.data) {
      const content = Buffer.from(messagePart.body.data, 'base64').toString('utf8');

      if (messagePart.mimeType === 'text/plain') {
        textContent = content;
      } else if (messagePart.mimeType === 'text/html') {
        htmlContent = content;
      }
    }

    if (messagePart.parts && messagePart.parts.length > 0) {
      for (const part of messagePart.parts) {
        const { text, html } = this.extractEmailContent(part);
        if (text) textContent += text;
        if (html) htmlContent += html;
      }
    }

    return { text: textContent, html: htmlContent };
  }

  private extractAttachments(messagePart: GmailMessagePart): EmailAttachment[] {
    const attachments: EmailAttachment[] = [];

    const processAttachmentParts = (part: GmailMessagePart) => {
      if (part.body && part.body.attachmentId) {
        const filename = part.filename || `attachment-${part.body.attachmentId}`;
        attachments.push({
          id: part.body.attachmentId,
          filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0
        });
      }

      if (part.parts) {
        part.parts.forEach(subpart => processAttachmentParts(subpart));
      }
    };

    if (messagePart) {
      processAttachmentParts(messagePart);
    }

    return attachments;
  }
}

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { BaseToolHandler } from './BaseToolHandler.js';
import { DownloadAttachmentArgs } from '../schemas/types.js';
import { DownloadAttachmentResponse, createStructuredResponse } from '../types/structured-responses.js';

export class DownloadAttachmentHandler extends BaseToolHandler<DownloadAttachmentArgs> {
  async runTool(args: DownloadAttachmentArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    let client: OAuth2Client;
    let accountId: string;

    if (args.account) {
      const result = this.getClientForAccount(args.account, accounts);
      client = result.client;
      accountId = result.accountId;
    } else {
      // Try to find which account has this message
      const found = await this.findAccountForMessage(args.messageId, accounts);
      if (found) {
        client = found.client;
        accountId = found.accountId;
      } else {
        const result = this.getClientForAccount(undefined, accounts);
        client = result.client;
        accountId = result.accountId;
      }
    }

    const gmail = this.getGmail(client);

    try {
      // Get the attachment data from Gmail API
      const attachmentResponse = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: args.messageId,
        id: args.attachmentId,
      });

      if (!attachmentResponse.data.data) {
        throw new Error('No attachment data received');
      }

      // Decode the base64 data
      const data = attachmentResponse.data.data;
      const buffer = Buffer.from(data, 'base64url');

      // Determine save path and filename
      const savePath = args.savePath || process.cwd();
      let filename = args.filename;

      if (!filename) {
        // Get original filename from message if not provided
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: args.messageId,
          format: 'full',
        });

        // Find the attachment part to get original filename
        const findAttachment = (part: any): string | null => {
          if (part.body && part.body.attachmentId === args.attachmentId) {
            return part.filename || `attachment-${args.attachmentId}`;
          }
          if (part.parts) {
            for (const subpart of part.parts) {
              const found = findAttachment(subpart);
              if (found) return found;
            }
          }
          return null;
        };

        filename = findAttachment(messageResponse.data.payload) || `attachment-${args.attachmentId}`;
      }

      // Ensure save directory exists
      if (!fs.existsSync(savePath)) {
        fs.mkdirSync(savePath, { recursive: true });
      }

      // Write file
      const fullPath = path.join(savePath, filename);
      fs.writeFileSync(fullPath, buffer);

      const result: DownloadAttachmentResponse = {
        success: true,
        filename,
        size: buffer.length,
        savedTo: fullPath,
        accountId,
        message: `Attachment downloaded successfully from account "${accountId}"`
      };

      return createStructuredResponse(result);
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

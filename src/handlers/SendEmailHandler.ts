import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OAuth2Client } from 'google-auth-library';
import { BaseToolHandler } from './BaseToolHandler.js';
import { SendEmailArgs } from '../schemas/types.js';
import { SendEmailResponse, DraftEmailResponse, createStructuredResponse } from '../types/structured-responses.js';
import { createEmailMessage, createEmailWithNodemailer } from '../utils/email-builder.js';

export class SendEmailHandler extends BaseToolHandler<SendEmailArgs> {
  private action: 'send' | 'draft';

  constructor(action: 'send' | 'draft' = 'send') {
    super();
    this.action = action;
  }

  async runTool(args: SendEmailArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const { client, accountId } = this.getClientForAccount(args.account, accounts);
    const gmail = this.getGmail(client);

    try {
      let message: string;
      
      // Check if we have attachments
      if (args.attachments && args.attachments.length > 0) {
        // Use Nodemailer to create properly formatted RFC822 message
        message = await createEmailWithNodemailer(args);
      } else {
        // For emails without attachments, use the simple method
        message = createEmailMessage(args);
      }

      const encodedMessage = Buffer.from(message).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const messageRequest: any = {
        raw: encodedMessage,
      };

      if (args.threadId) {
        messageRequest.threadId = args.threadId;
      }

      if (this.action === 'send') {
        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: messageRequest,
        });

        const result: SendEmailResponse = {
          success: true,
          messageId: response.data.id || '',
          threadId: response.data.threadId || undefined,
          accountId,
          message: `Email sent successfully from account "${accountId}"`
        };

        return createStructuredResponse(result);
      } else {
        const response = await gmail.users.drafts.create({
          userId: 'me',
          requestBody: {
            message: messageRequest,
          },
        });

        const result: DraftEmailResponse = {
          success: true,
          draftId: response.data.id || '',
          messageId: response.data.message?.id || undefined,
          accountId,
          message: `Email draft created successfully in account "${accountId}"`
        };

        return createStructuredResponse(result);
      }
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

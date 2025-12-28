import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OAuth2Client } from 'google-auth-library';
import { BaseToolHandler } from './BaseToolHandler.js';
import { ModifyEmailArgs } from '../schemas/types.js';
import { ModifyEmailResponse, createStructuredResponse } from '../types/structured-responses.js';

export class ModifyEmailHandler extends BaseToolHandler<ModifyEmailArgs> {
  async runTool(args: ModifyEmailArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
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
        // Fall back to single account or error
        const result = this.getClientForAccount(undefined, accounts);
        client = result.client;
        accountId = result.accountId;
      }
    }

    const gmail = this.getGmail(client);

    try {
      const requestBody: any = {};
      
      if (args.labelIds) {
        requestBody.addLabelIds = args.labelIds;
      }
      
      if (args.addLabelIds) {
        requestBody.addLabelIds = args.addLabelIds;
      }
      
      if (args.removeLabelIds) {
        requestBody.removeLabelIds = args.removeLabelIds;
      }
      
      await gmail.users.messages.modify({
        userId: 'me',
        id: args.messageId,
        requestBody,
      });

      const result: ModifyEmailResponse = {
        success: true,
        messageId: args.messageId,
        accountId,
        addedLabels: requestBody.addLabelIds,
        removedLabels: requestBody.removeLabelIds,
        message: `Email labels updated successfully in account "${accountId}"`
      };

      return createStructuredResponse(result);
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

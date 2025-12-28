import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OAuth2Client } from 'google-auth-library';
import { BaseToolHandler } from './BaseToolHandler.js';
import { DeleteEmailArgs } from '../schemas/types.js';
import { DeleteEmailResponse, createStructuredResponse } from '../types/structured-responses.js';

export class DeleteEmailHandler extends BaseToolHandler<DeleteEmailArgs> {
  async runTool(args: DeleteEmailArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
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
      await gmail.users.messages.delete({
        userId: 'me',
        id: args.messageId,
      });

      const result: DeleteEmailResponse = {
        success: true,
        messageId: args.messageId,
        accountId,
        message: `Email deleted successfully from account "${accountId}"`
      };

      return createStructuredResponse(result);
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

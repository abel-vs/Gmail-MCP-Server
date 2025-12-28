import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OAuth2Client } from 'google-auth-library';
import { BaseToolHandler } from './BaseToolHandler.js';
import { SearchEmailsArgs } from '../schemas/types.js';
import { SearchEmailsResponse, StructuredEmail, createStructuredResponse } from '../types/structured-responses.js';

export class SearchEmailsHandler extends BaseToolHandler<SearchEmailsArgs> {
  async runTool(args: SearchEmailsArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    // Get accounts to search
    const selectedAccounts = this.getClientsForAccounts(args.account, accounts);
    const isMultiAccount = selectedAccounts.size > 1;

    const allEmails: StructuredEmail[] = [];
    const errors: Array<{ accountId: string; error: string }> = [];

    // Search in each account
    await Promise.all(
      Array.from(selectedAccounts.entries()).map(async ([accountId, client]) => {
        try {
          const emails = await this.searchInAccount(client, accountId, args);
          allEmails.push(...emails);
        } catch (error) {
          if (selectedAccounts.size === 1) {
            throw error; // Single account - propagate error
          }
          errors.push({
            accountId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })
    );

    // Sort by date (newest first)
    allEmails.sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      return dateB - dateA;
    });

    // Apply maxResults limit after merging
    const limitedEmails = args.maxResults 
      ? allEmails.slice(0, args.maxResults)
      : allEmails;

    const result: SearchEmailsResponse = {
      emails: limitedEmails,
      totalCount: limitedEmails.length,
      query: args.query,
      ...(isMultiAccount && { accounts: Array.from(selectedAccounts.keys()) }),
      ...(errors.length > 0 && { 
        note: `Some accounts had errors: ${errors.map(e => `${e.accountId}: ${e.error}`).join('; ')}`
      })
    };

    return createStructuredResponse(result);
  }

  private async searchInAccount(
    client: OAuth2Client,
    accountId: string,
    args: SearchEmailsArgs
  ): Promise<StructuredEmail[]> {
    const gmail = this.getGmail(client);

    try {
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: args.query,
        maxResults: args.maxResults || 10,
      });

      const messages = response.data.messages || [];
      
      const emails = await Promise.all(
        messages.map(async (msg) => {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'To', 'Date'],
          });
          
          const headers = detail.data.payload?.headers || [];
          
          return {
            id: msg.id!,
            threadId: msg.threadId || '',
            accountId,
            subject: this.getHeader(headers, 'Subject'),
            from: this.getHeader(headers, 'From'),
            to: this.getHeader(headers, 'To'),
            date: this.getHeader(headers, 'Date'),
            snippet: detail.data.snippet || undefined,
            labels: detail.data.labelIds || undefined
          };
        })
      );

      return emails;
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }

  private getHeader(headers: Array<{ name?: string | null; value?: string | null }>, name: string): string {
    const header = headers.find(h => h.name === name);
    return header?.value || '';
  }
}

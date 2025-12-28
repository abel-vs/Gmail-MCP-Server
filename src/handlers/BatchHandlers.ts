import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OAuth2Client } from 'google-auth-library';
import { BaseToolHandler } from './BaseToolHandler.js';
import { BatchModifyEmailsArgs, BatchDeleteEmailsArgs } from '../schemas/types.js';
import { BatchOperationResult, createStructuredResponse } from '../types/structured-responses.js';

export class BatchModifyEmailsHandler extends BaseToolHandler<BatchModifyEmailsArgs> {
  async runTool(args: BatchModifyEmailsArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const { client, accountId } = this.getClientForAccount(args.account, accounts);
    const gmail = this.getGmail(client);

    const { messageIds } = args;
    const batchSize = args.batchSize || 50;

    const requestBody: any = {};
    if (args.addLabelIds) requestBody.addLabelIds = args.addLabelIds;
    if (args.removeLabelIds) requestBody.removeLabelIds = args.removeLabelIds;

    const successes: string[] = [];
    const failures: Array<{ id: string; error: string }> = [];

    // Process in batches
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (messageId) => {
          try {
            await gmail.users.messages.modify({
              userId: 'me',
              id: messageId,
              requestBody,
            });
            successes.push(messageId);
          } catch (error) {
            failures.push({
              id: messageId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        })
      );
    }

    const result: BatchOperationResult = {
      success: failures.length === 0,
      successCount: successes.length,
      failureCount: failures.length,
      failures: failures.length > 0 ? failures : undefined,
      accountId,
      message: `Batch modify complete: ${successes.length} succeeded, ${failures.length} failed`
    };

    return createStructuredResponse(result);
  }
}

export class BatchDeleteEmailsHandler extends BaseToolHandler<BatchDeleteEmailsArgs> {
  async runTool(args: BatchDeleteEmailsArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const { client, accountId } = this.getClientForAccount(args.account, accounts);
    const gmail = this.getGmail(client);

    const { messageIds } = args;
    const batchSize = args.batchSize || 50;

    const successes: string[] = [];
    const failures: Array<{ id: string; error: string }> = [];

    // Process in batches
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (messageId) => {
          try {
            await gmail.users.messages.delete({
              userId: 'me',
              id: messageId,
            });
            successes.push(messageId);
          } catch (error) {
            failures.push({
              id: messageId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        })
      );
    }

    const result: BatchOperationResult = {
      success: failures.length === 0,
      successCount: successes.length,
      failureCount: failures.length,
      failures: failures.length > 0 ? failures : undefined,
      accountId,
      message: `Batch delete complete: ${successes.length} succeeded, ${failures.length} failed`
    };

    return createStructuredResponse(result);
  }
}

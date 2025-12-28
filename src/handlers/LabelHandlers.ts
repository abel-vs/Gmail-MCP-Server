import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OAuth2Client } from 'google-auth-library';
import { BaseToolHandler } from './BaseToolHandler.js';
import {
  ListEmailLabelsArgs,
  CreateLabelArgs,
  UpdateLabelArgs,
  DeleteLabelArgs,
  GetOrCreateLabelArgs
} from '../schemas/types.js';
import {
  ListLabelsResponse,
  LabelInfo,
  LabelOperationResponse,
  createStructuredResponse
} from '../types/structured-responses.js';

export class ListLabelsHandler extends BaseToolHandler<ListEmailLabelsArgs> {
  async runTool(args: ListEmailLabelsArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const selectedAccounts = this.getClientsForAccounts(args.account, accounts);
    
    // For single account
    if (selectedAccounts.size === 1) {
      const [accountId, client] = selectedAccounts.entries().next().value!;
      return this.listLabelsForAccount(client, accountId);
    }

    // For multiple accounts, merge results
    const allLabels: (LabelInfo & { accountId: string })[] = [];
    
    for (const [accountId, client] of selectedAccounts) {
      try {
        const gmail = this.getGmail(client);
        const response = await gmail.users.labels.list({ userId: 'me' });
        const labels = response.data.labels || [];
        
        for (const label of labels) {
          allLabels.push({
            id: label.id || '',
            name: label.name || '',
            type: (label.type as 'system' | 'user') || 'user',
            messageListVisibility: label.messageListVisibility || undefined,
            labelListVisibility: label.labelListVisibility || undefined,
            messagesTotal: label.messagesTotal || undefined,
            messagesUnread: label.messagesUnread || undefined,
            accountId
          });
        }
      } catch (error) {
        // Continue with other accounts
      }
    }

    const systemLabels = allLabels.filter(l => l.type === 'system');
    const userLabels = allLabels.filter(l => l.type === 'user');

    const result: ListLabelsResponse & { accounts: string[] } = {
      labels: allLabels,
      systemCount: systemLabels.length,
      userCount: userLabels.length,
      totalCount: allLabels.length,
      accounts: Array.from(selectedAccounts.keys())
    };

    return createStructuredResponse(result);
  }

  private async listLabelsForAccount(client: OAuth2Client, accountId: string): Promise<CallToolResult> {
    const gmail = this.getGmail(client);

    try {
      const response = await gmail.users.labels.list({ userId: 'me' });
      const labels = response.data.labels || [];

      const labelInfos: LabelInfo[] = labels.map(label => ({
        id: label.id || '',
        name: label.name || '',
        type: (label.type as 'system' | 'user') || 'user',
        messageListVisibility: label.messageListVisibility || undefined,
        labelListVisibility: label.labelListVisibility || undefined,
        messagesTotal: label.messagesTotal || undefined,
        messagesUnread: label.messagesUnread || undefined
      }));

      const systemLabels = labelInfos.filter(l => l.type === 'system');
      const userLabels = labelInfos.filter(l => l.type === 'user');

      const result: ListLabelsResponse = {
        labels: labelInfos,
        systemCount: systemLabels.length,
        userCount: userLabels.length,
        totalCount: labelInfos.length,
        accountId
      };

      return createStructuredResponse(result);
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

export class CreateLabelHandler extends BaseToolHandler<CreateLabelArgs> {
  async runTool(args: CreateLabelArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const { client, accountId } = this.getClientForAccount(args.account, accounts);
    const gmail = this.getGmail(client);

    try {
      const response = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: args.name,
          messageListVisibility: args.messageListVisibility || 'show',
          labelListVisibility: args.labelListVisibility || 'labelShow',
        },
      });

      const result: LabelOperationResponse = {
        success: true,
        label: {
          id: response.data.id || '',
          name: response.data.name || '',
          type: (response.data.type as 'system' | 'user') || 'user',
          messageListVisibility: response.data.messageListVisibility || undefined,
          labelListVisibility: response.data.labelListVisibility || undefined
        },
        accountId,
        message: `Label "${args.name}" created successfully in account "${accountId}"`
      };

      return createStructuredResponse(result);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        throw new Error(`Label "${args.name}" already exists. Please use a different name.`);
      }
      throw this.handleGoogleApiError(error);
    }
  }
}

export class UpdateLabelHandler extends BaseToolHandler<UpdateLabelArgs> {
  async runTool(args: UpdateLabelArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const { client, accountId } = this.getClientForAccount(args.account, accounts);
    const gmail = this.getGmail(client);

    try {
      const updates: any = {};
      if (args.name) updates.name = args.name;
      if (args.messageListVisibility) updates.messageListVisibility = args.messageListVisibility;
      if (args.labelListVisibility) updates.labelListVisibility = args.labelListVisibility;

      const response = await gmail.users.labels.update({
        userId: 'me',
        id: args.id,
        requestBody: updates,
      });

      const result: LabelOperationResponse = {
        success: true,
        label: {
          id: response.data.id || '',
          name: response.data.name || '',
          type: (response.data.type as 'system' | 'user') || 'user',
          messageListVisibility: response.data.messageListVisibility || undefined,
          labelListVisibility: response.data.labelListVisibility || undefined
        },
        accountId,
        message: `Label updated successfully in account "${accountId}"`
      };

      return createStructuredResponse(result);
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

export class DeleteLabelHandler extends BaseToolHandler<DeleteLabelArgs> {
  async runTool(args: DeleteLabelArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const { client, accountId } = this.getClientForAccount(args.account, accounts);
    const gmail = this.getGmail(client);

    try {
      // First get the label to check if it's a system label
      const label = await gmail.users.labels.get({
        userId: 'me',
        id: args.id,
      });

      if (label.data.type === 'system') {
        throw new Error(`Cannot delete system label with ID "${args.id}".`);
      }

      await gmail.users.labels.delete({
        userId: 'me',
        id: args.id,
      });

      return createStructuredResponse({
        success: true,
        labelId: args.id,
        labelName: label.data.name,
        accountId,
        message: `Label "${label.data.name}" deleted successfully from account "${accountId}"`
      });
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

export class GetOrCreateLabelHandler extends BaseToolHandler<GetOrCreateLabelArgs> {
  async runTool(args: GetOrCreateLabelArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const { client, accountId } = this.getClientForAccount(args.account, accounts);
    const gmail = this.getGmail(client);

    try {
      // First try to find an existing label
      const response = await gmail.users.labels.list({ userId: 'me' });
      const labels = response.data.labels || [];
      
      const existingLabel = labels.find(
        label => label.name?.toLowerCase() === args.name.toLowerCase()
      );

      if (existingLabel) {
        const result: LabelOperationResponse = {
          success: true,
          label: {
            id: existingLabel.id || '',
            name: existingLabel.name || '',
            type: (existingLabel.type as 'system' | 'user') || 'user',
            messageListVisibility: existingLabel.messageListVisibility || undefined,
            labelListVisibility: existingLabel.labelListVisibility || undefined
          },
          accountId,
          message: `Found existing label "${existingLabel.name}" in account "${accountId}"`
        };

        return createStructuredResponse(result);
      }

      // Label not found, create it
      const createResponse = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: args.name,
          messageListVisibility: args.messageListVisibility || 'show',
          labelListVisibility: args.labelListVisibility || 'labelShow',
        },
      });

      const result: LabelOperationResponse = {
        success: true,
        label: {
          id: createResponse.data.id || '',
          name: createResponse.data.name || '',
          type: (createResponse.data.type as 'system' | 'user') || 'user',
          messageListVisibility: createResponse.data.messageListVisibility || undefined,
          labelListVisibility: createResponse.data.labelListVisibility || undefined
        },
        accountId,
        message: `Created new label "${args.name}" in account "${accountId}"`
      };

      return createStructuredResponse(result);
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

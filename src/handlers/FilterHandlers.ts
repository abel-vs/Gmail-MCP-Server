import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OAuth2Client } from 'google-auth-library';
import { BaseToolHandler } from './BaseToolHandler.js';
import {
  CreateFilterArgs,
  ListFiltersArgs,
  GetFilterArgs,
  DeleteFilterArgs,
  CreateFilterFromTemplateArgs
} from '../schemas/types.js';
import {
  ListFiltersResponse,
  FilterInfo,
  FilterOperationResponse,
  createStructuredResponse
} from '../types/structured-responses.js';
import { filterTemplates } from '../filter-manager.js';

export class CreateFilterHandler extends BaseToolHandler<CreateFilterArgs> {
  async runTool(args: CreateFilterArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const { client, accountId } = this.getClientForAccount(args.account, accounts);
    const gmail = this.getGmail(client);

    try {
      const response = await gmail.users.settings.filters.create({
        userId: 'me',
        requestBody: {
          criteria: args.criteria,
          action: args.action,
        },
      });

      const result: FilterOperationResponse = {
        success: true,
        filter: {
          id: response.data.id || '',
          criteria: response.data.criteria || {},
          action: response.data.action || {}
        },
        accountId,
        message: `Filter created successfully in account "${accountId}"`
      };

      return createStructuredResponse(result);
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

export class ListFiltersHandler extends BaseToolHandler<ListFiltersArgs> {
  async runTool(args: ListFiltersArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const selectedAccounts = this.getClientsForAccounts(args.account, accounts);

    // For single account
    if (selectedAccounts.size === 1) {
      const [accountId, client] = selectedAccounts.entries().next().value!;
      return this.listFiltersForAccount(client, accountId);
    }

    // For multiple accounts, merge results
    const allFilters: (FilterInfo & { accountId: string })[] = [];

    for (const [accountId, client] of selectedAccounts) {
      try {
        const gmail = this.getGmail(client);
        const response = await gmail.users.settings.filters.list({ userId: 'me' });
        const filters = response.data.filter || [];

        for (const filter of filters) {
          allFilters.push({
            id: filter.id || '',
            criteria: filter.criteria || {},
            action: filter.action || {},
            accountId
          });
        }
      } catch (error) {
        // Continue with other accounts
      }
    }

    const result: ListFiltersResponse & { accounts: string[] } = {
      filters: allFilters,
      count: allFilters.length,
      accounts: Array.from(selectedAccounts.keys())
    };

    return createStructuredResponse(result);
  }

  private async listFiltersForAccount(client: OAuth2Client, accountId: string): Promise<CallToolResult> {
    const gmail = this.getGmail(client);

    try {
      const response = await gmail.users.settings.filters.list({ userId: 'me' });
      const filters = response.data.filter || [];

      const filterInfos: FilterInfo[] = filters.map(filter => ({
        id: filter.id || '',
        criteria: filter.criteria || {},
        action: filter.action || {}
      }));

      const result: ListFiltersResponse = {
        filters: filterInfos,
        count: filterInfos.length,
        accountId
      };

      return createStructuredResponse(result);
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

export class GetFilterHandler extends BaseToolHandler<GetFilterArgs> {
  async runTool(args: GetFilterArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const { client, accountId } = this.getClientForAccount(args.account, accounts);
    const gmail = this.getGmail(client);

    try {
      const response = await gmail.users.settings.filters.get({
        userId: 'me',
        id: args.filterId,
      });

      const result: FilterOperationResponse = {
        success: true,
        filter: {
          id: response.data.id || '',
          criteria: response.data.criteria || {},
          action: response.data.action || {}
        },
        accountId,
        message: `Filter retrieved from account "${accountId}"`
      };

      return createStructuredResponse(result);
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

export class DeleteFilterHandler extends BaseToolHandler<DeleteFilterArgs> {
  async runTool(args: DeleteFilterArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const { client, accountId } = this.getClientForAccount(args.account, accounts);
    const gmail = this.getGmail(client);

    try {
      await gmail.users.settings.filters.delete({
        userId: 'me',
        id: args.filterId,
      });

      return createStructuredResponse({
        success: true,
        filterId: args.filterId,
        accountId,
        message: `Filter deleted successfully from account "${accountId}"`
      });
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

export class CreateFilterFromTemplateHandler extends BaseToolHandler<CreateFilterFromTemplateArgs> {
  async runTool(args: CreateFilterFromTemplateArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const { client, accountId } = this.getClientForAccount(args.account, accounts);
    const gmail = this.getGmail(client);

    const { template, parameters: params } = args;

    let filterConfig: { criteria: any; action: any };

    switch (template) {
      case 'fromSender':
        if (!params.senderEmail) throw new Error('senderEmail is required for fromSender template');
        filterConfig = filterTemplates.fromSender(params.senderEmail, params.labelIds, params.archive);
        break;
      case 'withSubject':
        if (!params.subjectText) throw new Error('subjectText is required for withSubject template');
        filterConfig = filterTemplates.withSubject(params.subjectText, params.labelIds, params.markAsRead);
        break;
      case 'withAttachments':
        filterConfig = filterTemplates.withAttachments(params.labelIds);
        break;
      case 'largeEmails':
        if (!params.sizeInBytes) throw new Error('sizeInBytes is required for largeEmails template');
        filterConfig = filterTemplates.largeEmails(params.sizeInBytes, params.labelIds);
        break;
      case 'containingText':
        if (!params.searchText) throw new Error('searchText is required for containingText template');
        filterConfig = filterTemplates.containingText(params.searchText, params.labelIds, params.markImportant);
        break;
      case 'mailingList':
        if (!params.listIdentifier) throw new Error('listIdentifier is required for mailingList template');
        filterConfig = filterTemplates.mailingList(params.listIdentifier, params.labelIds, params.archive);
        break;
      default:
        throw new Error(`Unknown template: ${template}`);
    }

    try {
      const response = await gmail.users.settings.filters.create({
        userId: 'me',
        requestBody: {
          criteria: filterConfig.criteria,
          action: filterConfig.action,
        },
      });

      const result: FilterOperationResponse = {
        success: true,
        filter: {
          id: response.data.id || '',
          criteria: response.data.criteria || {},
          action: response.data.action || {}
        },
        accountId,
        message: `Filter created from template '${template}' in account "${accountId}"`
      };

      return createStructuredResponse(result);
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }
}

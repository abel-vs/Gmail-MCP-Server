#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { OAuth2Client } from 'google-auth-library';

// Auth module
import { initializeOAuth2Client } from './auth/client.js';
import { TokenManager } from './auth/tokenManager.js';
import { AuthServer } from './auth/server.js';

// Schemas
import {
  SendEmailSchema,
  ReadEmailSchema,
  SearchEmailsSchema,
  ModifyEmailSchema,
  DeleteEmailSchema,
  BatchModifyEmailsSchema,
  BatchDeleteEmailsSchema,
  ListEmailLabelsSchema,
  CreateLabelSchema,
  UpdateLabelSchema,
  DeleteLabelSchema,
  GetOrCreateLabelSchema,
  CreateFilterSchema,
  ListFiltersSchema,
  GetFilterSchema,
  DeleteFilterSchema,
  CreateFilterFromTemplateSchema,
  DownloadAttachmentSchema,
  ManageAccountsSchema,
} from './schemas/types.js';

// Handlers
import { SendEmailHandler } from './handlers/SendEmailHandler.js';
import { ReadEmailHandler } from './handlers/ReadEmailHandler.js';
import { SearchEmailsHandler } from './handlers/SearchEmailsHandler.js';
import { ModifyEmailHandler } from './handlers/ModifyEmailHandler.js';
import { DeleteEmailHandler } from './handlers/DeleteEmailHandler.js';
import { BatchModifyEmailsHandler, BatchDeleteEmailsHandler } from './handlers/BatchHandlers.js';
import {
  ListLabelsHandler,
  CreateLabelHandler,
  UpdateLabelHandler,
  DeleteLabelHandler,
  GetOrCreateLabelHandler,
} from './handlers/LabelHandlers.js';
import {
  CreateFilterHandler,
  ListFiltersHandler,
  GetFilterHandler,
  DeleteFilterHandler,
  CreateFilterFromTemplateHandler,
} from './handlers/FilterHandlers.js';
import { DownloadAttachmentHandler } from './handlers/DownloadAttachmentHandler.js';
import { ManageAccountsHandler, ServerContext } from './handlers/ManageAccountsHandler.js';

// Services
import { MailboxRegistry } from './services/MailboxRegistry.js';

// Global state
let oauth2Client: OAuth2Client;
let tokenManager: TokenManager;
let authServer: AuthServer;
let accounts: Map<string, OAuth2Client> = new Map();

// Handler instances
const sendEmailHandler = new SendEmailHandler('send');
const draftEmailHandler = new SendEmailHandler('draft');
const readEmailHandler = new ReadEmailHandler();
const searchEmailsHandler = new SearchEmailsHandler();
const modifyEmailHandler = new ModifyEmailHandler();
const deleteEmailHandler = new DeleteEmailHandler();
const batchModifyHandler = new BatchModifyEmailsHandler();
const batchDeleteHandler = new BatchDeleteEmailsHandler();
const listLabelsHandler = new ListLabelsHandler();
const createLabelHandler = new CreateLabelHandler();
const updateLabelHandler = new UpdateLabelHandler();
const deleteLabelHandler = new DeleteLabelHandler();
const getOrCreateLabelHandler = new GetOrCreateLabelHandler();
const createFilterHandler = new CreateFilterHandler();
const listFiltersHandler = new ListFiltersHandler();
const getFilterHandler = new GetFilterHandler();
const deleteFilterHandler = new DeleteFilterHandler();
const createFilterFromTemplateHandler = new CreateFilterFromTemplateHandler();
const downloadAttachmentHandler = new DownloadAttachmentHandler();
const manageAccountsHandler = new ManageAccountsHandler();

/**
 * Reload accounts from token storage
 */
async function reloadAccounts(): Promise<Map<string, OAuth2Client>> {
  accounts = await tokenManager.loadAllAccounts();
  // Clear mailbox registry cache when accounts change
  MailboxRegistry.resetInstance();
  return accounts;
}

/**
 * Get server context for ManageAccountsHandler
 */
function getServerContext(): ServerContext {
  return {
    oauth2Client,
    tokenManager,
    authServer,
    accounts,
    reloadAccounts,
  };
}

/**
 * Initialize the server
 */
async function initialize(): Promise<void> {
  oauth2Client = await initializeOAuth2Client();
  tokenManager = new TokenManager(oauth2Client);
  authServer = new AuthServer(oauth2Client, tokenManager);
  
  // Load all accounts
  await reloadAccounts();
  
  process.stderr.write(`Loaded ${accounts.size} account(s)\n`);
}

/**
 * CLI Authentication handler
 */
async function handleCLIAuth(): Promise<void> {
  await initialize();
  
  const accountId = process.argv[3] || 'normal';
  
  console.log(`Authenticating account "${accountId}"...`);
  
  await authServer.authenticate(accountId);
  
  // Reload to verify
  await reloadAccounts();
  
  if (accounts.has(accountId)) {
    console.log(`Authentication completed successfully for account "${accountId}"`);
  } else {
    console.error('Authentication may have failed. Please try again.');
            process.exit(1);
        }

  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Handle CLI auth command
  if (process.argv[2] === 'auth') {
    await handleCLIAuth();
                return;
            }

  // Initialize for MCP server mode
  await initialize();

    // Server implementation
    const server = new Server({
    name: 'gmail',
    version: '2.0.0',
        capabilities: {
            tools: {},
        },
    });

    // Tool handlers
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
        name: 'manage-accounts',
        description: 'Manage Gmail accounts - list, add, or remove accounts',
        inputSchema: zodToJsonSchema(ManageAccountsSchema),
      },
      {
        name: 'send_email',
        description: 'Sends a new email',
                inputSchema: zodToJsonSchema(SendEmailSchema),
            },
            {
        name: 'draft_email',
        description: 'Draft a new email',
                inputSchema: zodToJsonSchema(SendEmailSchema),
            },
            {
        name: 'read_email',
        description: 'Retrieves the content of a specific email',
                inputSchema: zodToJsonSchema(ReadEmailSchema),
            },
            {
        name: 'search_emails',
        description: 'Searches for emails using Gmail search syntax',
                inputSchema: zodToJsonSchema(SearchEmailsSchema),
            },
            {
        name: 'modify_email',
        description: 'Modifies email labels (move to different folders)',
                inputSchema: zodToJsonSchema(ModifyEmailSchema),
            },
            {
        name: 'delete_email',
        description: 'Permanently deletes an email',
                inputSchema: zodToJsonSchema(DeleteEmailSchema),
            },
            {
        name: 'list_email_labels',
        description: 'Retrieves all available Gmail labels',
                inputSchema: zodToJsonSchema(ListEmailLabelsSchema),
            },
            {
        name: 'batch_modify_emails',
        description: 'Modifies labels for multiple emails in batches',
                inputSchema: zodToJsonSchema(BatchModifyEmailsSchema),
            },
            {
        name: 'batch_delete_emails',
        description: 'Permanently deletes multiple emails in batches',
                inputSchema: zodToJsonSchema(BatchDeleteEmailsSchema),
            },
            {
        name: 'create_label',
        description: 'Creates a new Gmail label',
                inputSchema: zodToJsonSchema(CreateLabelSchema),
            },
            {
        name: 'update_label',
        description: 'Updates an existing Gmail label',
                inputSchema: zodToJsonSchema(UpdateLabelSchema),
            },
            {
        name: 'delete_label',
        description: 'Deletes a Gmail label',
                inputSchema: zodToJsonSchema(DeleteLabelSchema),
            },
            {
        name: 'get_or_create_label',
        description: 'Gets an existing label by name or creates it if it doesn\'t exist',
                inputSchema: zodToJsonSchema(GetOrCreateLabelSchema),
            },
            {
        name: 'create_filter',
        description: 'Creates a new Gmail filter with custom criteria and actions',
                inputSchema: zodToJsonSchema(CreateFilterSchema),
            },
            {
        name: 'list_filters',
        description: 'Retrieves all Gmail filters',
                inputSchema: zodToJsonSchema(ListFiltersSchema),
            },
            {
        name: 'get_filter',
        description: 'Gets details of a specific Gmail filter',
                inputSchema: zodToJsonSchema(GetFilterSchema),
            },
            {
        name: 'delete_filter',
        description: 'Deletes a Gmail filter',
                inputSchema: zodToJsonSchema(DeleteFilterSchema),
            },
            {
        name: 'create_filter_from_template',
        description: 'Creates a filter using a pre-defined template for common scenarios',
                inputSchema: zodToJsonSchema(CreateFilterFromTemplateSchema),
            },
            {
        name: 'download_attachment',
        description: 'Downloads an email attachment to a specified location',
                inputSchema: zodToJsonSchema(DownloadAttachmentSchema),
            },
        ],
  }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

    // Reload accounts before each request to ensure we have latest state
    await reloadAccounts();

        try {
            switch (name) {
        case 'manage-accounts':
          return await manageAccountsHandler.runTool(args as any, getServerContext());

        case 'send_email':
          return await sendEmailHandler.runTool(args as any, accounts);

        case 'draft_email':
          return await draftEmailHandler.runTool(args as any, accounts);

        case 'read_email':
          return await readEmailHandler.runTool(args as any, accounts);

        case 'search_emails':
          return await searchEmailsHandler.runTool(args as any, accounts);

        case 'modify_email':
          return await modifyEmailHandler.runTool(args as any, accounts);

        case 'delete_email':
          return await deleteEmailHandler.runTool(args as any, accounts);

        case 'list_email_labels':
          return await listLabelsHandler.runTool(args as any, accounts);

        case 'batch_modify_emails':
          return await batchModifyHandler.runTool(args as any, accounts);

        case 'batch_delete_emails':
          return await batchDeleteHandler.runTool(args as any, accounts);

        case 'create_label':
          return await createLabelHandler.runTool(args as any, accounts);

        case 'update_label':
          return await updateLabelHandler.runTool(args as any, accounts);

        case 'delete_label':
          return await deleteLabelHandler.runTool(args as any, accounts);

        case 'get_or_create_label':
          return await getOrCreateLabelHandler.runTool(args as any, accounts);

        case 'create_filter':
          return await createFilterHandler.runTool(args as any, accounts);

        case 'list_filters':
          return await listFiltersHandler.runTool(args as any, accounts);

        case 'get_filter':
          return await getFilterHandler.runTool(args as any, accounts);

        case 'delete_filter':
          return await deleteFilterHandler.runTool(args as any, accounts);

        case 'create_filter_from_template':
          return await createFilterFromTemplateHandler.runTool(args as any, accounts);

        case 'download_attachment':
          return await downloadAttachmentHandler.runTool(args as any, accounts);

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error: any) {
            return {
                content: [
                    {
            type: 'text',
                        text: `Error: ${error.message}`,
                    },
                ],
            };
        }
    });

    const transport = new StdioServerTransport();
    server.connect(transport);
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});

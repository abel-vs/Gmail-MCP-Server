# Agent Guidelines

This document provides instructions for AI agents interacting with the Gmail MCP server.

## Multi-Account Handling

This server supports connecting to multiple Google accounts simultaneously (e.g., "work", "personal").

### Detecting Accounts
You can list available accounts using the `manage-accounts` tool with action `list`. This will return all connected accounts with their email addresses.

### Using the `account` Parameter
Most tools accept an optional `account` parameter.

- **If `account` is OMITTED**:
    - Read operations (like `search_emails`) will query **all** accounts and merge results.
    - Write operations (like `send_email`) will fail if multiple accounts exist - you must specify which account to use.

- **If `account` is SPECIFIED**:
    - The operation is restricted to that specific account.
    - Use this when the user explicitly asks to "check my work email" or "send from my personal account".

### Managing Accounts

Use the `manage-accounts` tool to:
- **list**: See all connected accounts and their status
- **add**: Connect a new Gmail account with a nickname (e.g., "work", "personal")
- **remove**: Disconnect an account

### Example: Listing Accounts
```json
{
  "name": "manage-accounts",
  "arguments": {
    "action": "list"
  }
}
```

### Example: Adding an Account
```json
{
  "name": "manage-accounts",
  "arguments": {
    "action": "add",
    "account_id": "work"
  }
}
```

### Example: Searching Emails
```json
{
  "name": "search_emails",
  "arguments": {
    "query": "from:example@gmail.com",
    "account": "work"
  }
}
```

### Example: Sending an Email
```json
{
  "name": "send_email",
  "arguments": {
    "to": ["recipient@example.com"],
    "subject": "Hello",
    "body": "Message content",
    "account": "personal"
  }
}
```

## Account ID Format
Account IDs must be:
- 1-64 characters long
- Lowercase letters, numbers, dashes, and underscores only
- Examples: `work`, `personal`, `my-company`, `side_project`

## Token Storage
Tokens are securely stored in `~/.config/gmail-mcp/tokens.json` with restricted permissions.

# IDEA-005: Etsy API MCP Integration

## Status: blocked
Blocked on: Etsy developer app pending approval (submitted 2026-03-19)

## Summary
Connect to Etsy Open API v3 via MCP server for automated listing management, inventory updates, and shop analytics.

## What's Already Done
- MCP server: profplum700/etsy-mcp-server (GitHub)
- Installed at: `tools/etsy-mcp-server/` (cloned and built)
- `.mcp.json` created with placeholder credentials
- API Keystring obtained: stored in `.mcp.json`

## Setup Plan (once app is approved)
1. Operator: regenerate Shared Secret from Etsy developer dashboard (original exposed in chat)
2. Operator: update `.mcp.json` with new Shared Secret
3. Run OAuth flow to obtain refresh token
4. Update `.mcp.json` with refresh token
5. Test connection: use Etsy MCP tools to query shop info

## Available MCP Tools (once connected)
- `getMe` — get authenticated user info
- `getShop` — get shop details
- `getListingsByShop` — list all shop listings
- `createDraftListing` — create a new draft listing
- `updateListing` — update an existing listing
- `getListingInventory` / `updateListingInventory` — manage inventory
- `uploadListingImage` — upload product images
- `getListingImages` / `getListingFiles` — get listing media
- `getSellerTaxonomyNodes` / `getPropertiesByTaxonomyId` — browse categories
- `getShopSections` — manage shop sections

## Future Potential
- Automated listing creation from pipeline outputs
- Inventory sync and monitoring
- Sales data feed into analyst reports
- Move approval workflow from manual upload to API-based publishing

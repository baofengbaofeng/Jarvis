# MCP binding owned by Agent — Design

Date: 2026-08-09  
Status: Implemented

## Goal

MCP servers are shared capabilities. Agents **opt in** to MCP servers. Binding is configured on the Agent, not on the MCP settings page.

## Changes

1. **Schema:** `agents.mcp_server_ids_json TEXT NOT NULL DEFAULT '[]'` (migration v17).
2. **Migrate:** Invert existing `mcp_servers.config_json.agentIds` into each agent’s `mcpServerIds`; clear `agentIds` on servers afterward.
3. **Types:** `AgentConfig` / `AgentInput` gain `mcpServerIds: string[]` (server UUIDs).
4. **Runtime:** `listBoundMcpServerNames`, `registerAgentMcpTools`, `listAutoApproveToolIds`, visibility use agent’s `mcpServerIds` (resolve id→name among enabled servers). Ignore `config.agentIds` at runtime.
5. **UI:** Remove Agent checkboxes from MCP settings; add MCP multi-select on Agent detail editor.
6. **i18n:** Update MCP subtitle/copy; add Agent MCP section keys (zh-CN + en).

## Non-goals

- Per-tool agent binding
- Changing Claude `mcpServers` JSON import for foreign clients (still no agentIds)

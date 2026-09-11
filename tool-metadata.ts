import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpExtensionState } from "./state.ts";
import type { ToolMetadata, McpTool, McpResource, ServerEntry, ToolPrefix } from "./types.ts";
import { formatToolName, getServerPrefix, isToolAllowed } from "./types.ts";
import { resourceNameToToolName } from "./resource-tools.ts";
import { extractToolUiStreamMode } from "./utils.ts";

export function buildToolMetadata(
  tools: McpTool[],
  resources: McpResource[],
  definition: ServerEntry,
  serverName: string,
  prefix: ToolPrefix
): { metadata: ToolMetadata[]; failedTools: string[] } {
  const metadata: ToolMetadata[] = [];
  const failedTools: string[] = [];
  const seenNames = new Set<string>();

  for (const tool of tools) {
    if (!tool?.name) {
      failedTools.push("(unnamed)");
      continue;
    }
    if (!isToolAllowed(tool.name, serverName, prefix, definition.includeTools, definition.excludeTools)) {
      continue;
    }

    const name = formatToolName(tool.name, serverName, prefix);
    if (seenNames.has(name)) {
      continue;
    }
    seenNames.add(name);

    let uiResourceUri: string | undefined;
    try {
      uiResourceUri = getToolUiResourceUri({ _meta: tool._meta });
    } catch {
      failedTools.push(tool.name);
    }
    metadata.push({
      name,
      originalName: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
      uiResourceUri,
      uiStreamMode: extractToolUiStreamMode(tool._meta),
    });
  }

  if (definition.exposeResources !== false) {
    for (const resource of resources) {
      const baseName = `read_${resourceNameToToolName(resource.name)}`;
      if (!isToolAllowed(baseName, serverName, prefix, definition.includeTools, definition.excludeTools)) {
        continue;
      }

      const name = formatToolName(baseName, serverName, prefix);
      if (seenNames.has(name)) {
        continue;
      }
      seenNames.add(name);

      metadata.push({
        name,
        originalName: baseName,
        description: resource.description ?? `Read resource: ${resource.uri}`,
        resourceUri: resource.uri,
      });
    }
  }

  return { metadata, failedTools };
}

export function getAuthorizedToolMetadata(state: McpExtensionState, serverName: string): ToolMetadata[] {
  const definition = state.config.mcpServers[serverName];
  if (!definition) return [];
  const prefix = state.config.settings?.toolPrefix ?? "server";
  return (state.toolMetadata.get(serverName) ?? []).filter((metadata) =>
    isToolAllowed(metadata.originalName || metadata.name, serverName, prefix, definition.includeTools, definition.excludeTools)
  );
}

export function isToolMetadataAuthorized(state: McpExtensionState, serverName: string, metadata: ToolMetadata): boolean {
  const definition = state.config.mcpServers[serverName];
  if (!definition) return false;
  const prefix = state.config.settings?.toolPrefix ?? "server";
  return isToolAllowed(metadata.originalName || metadata.name, serverName, prefix, definition.includeTools, definition.excludeTools);
}

function findMetadataByRequestedName(metadata: ToolMetadata[], toolName: string, allowOriginalName: boolean): ToolMetadata | undefined {
  const byPublicName = findToolByName(metadata, toolName);
  if (byPublicName || !allowOriginalName) return byPublicName;
  const normalized = toolName.replace(/-/g, "_");
  return metadata.find((item) => (item.originalName || item.name).replace(/-/g, "_") === normalized);
}

export type ToolRequestAuthorization =
  | { status: "allowed"; metadata: ToolMetadata }
  | { status: "denied"; metadata: ToolMetadata }
  | { status: "unknown" };

/** Resolve a requested raw/public name to the current server inventory, then apply active policy. */
export function resolveToolRequestAuthorization(
  state: McpExtensionState,
  serverName: string,
  toolName: string,
  allowOriginalName = false,
): ToolRequestAuthorization {
  const definition = state.config.mcpServers[serverName];
  if (!definition) return { status: "unknown" };
  const prefix = state.config.settings?.toolPrefix ?? "server";
  let metadata = findMetadataByRequestedName(state.toolMetadata.get(serverName) ?? [], toolName, allowOriginalName);
  if (!metadata) {
    const connection = state.manager.getConnection(serverName);
    if (connection?.status === "connected") {
      const unrestricted = buildToolMetadata(
        connection.tools ?? [],
        connection.resources ?? [],
        { ...definition, includeTools: undefined, excludeTools: undefined },
        serverName,
        prefix,
      ).metadata;
      metadata = findMetadataByRequestedName(unrestricted, toolName, allowOriginalName);
    }
  }
  if (!metadata) return { status: "unknown" };
  return isToolMetadataAuthorized(state, serverName, metadata)
    ? { status: "allowed", metadata }
    : { status: "denied", metadata };
}

export function findAuthorizedToolByName(
  state: McpExtensionState,
  serverName: string,
  toolName: string,
  allowOriginalName = false,
): ToolMetadata | undefined {
  const authorization = resolveToolRequestAuthorization(state, serverName, toolName, allowOriginalName);
  return authorization.status === "allowed" ? authorization.metadata : undefined;
}

export function getToolNames(state: McpExtensionState, serverName: string): string[] {
  return getAuthorizedToolMetadata(state, serverName).map(m => m.name);
}

export function totalToolCount(state: McpExtensionState): number {
  let count = 0;
  for (const serverName of state.toolMetadata.keys()) {
    count += getAuthorizedToolMetadata(state, serverName).length;
  }
  return count;
}

export function findToolByName(metadata: ToolMetadata[] | undefined, toolName: string): ToolMetadata | undefined {
  if (!metadata) return undefined;
  const exact = metadata.find(m => m.name === toolName);
  if (exact) return exact;
  const normalized = toolName.replace(/-/g, "_");
  return metadata.find(m => m.name.replace(/-/g, "_") === normalized);
}

export function formatSchema(schema: unknown, indent = "  "): string {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return `${indent}(no schema)`;
  }

  const s = schema as Record<string, unknown>;

  if (s.type === "object" && s.properties && typeof s.properties === "object" && !Array.isArray(s.properties)) {
    const props = s.properties as Record<string, unknown>;
    const required = Array.isArray(s.required) ? s.required.filter((name): name is string => typeof name === "string") : [];

    if (Object.keys(props).length === 0) {
      return `${indent}(no parameters)`;
    }

    const lines: string[] = [];
    for (const [name, propSchema] of Object.entries(props)) {
      lines.push(...formatProperty(name, propSchema, required.includes(name), indent));
    }
    return lines.join("\n");
  }

  const lines = formatNestedSchema(s, indent);
  if (lines.length > 0) {
    return lines.join("\n");
  }

  const typeStr = formatType(s);
  if (typeStr) {
    return `${indent}(${typeStr})`;
  }

  return `${indent}(complex schema)`;
}

function formatProperty(name: string, schema: unknown, required: boolean, indent: string): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return [`${indent}${name}${required ? " *required*" : ""}`];
  }

  const s = schema as Record<string, unknown>;
  const parts = [`${indent}${name}`];
  const typeStr = formatType(s);
  if (typeStr) parts.push(`(${typeStr})`);
  if (required) parts.push("*required*");
  appendSchemaAnnotations(parts, s);

  return [parts.join(" "), ...formatNestedSchema(s, `${indent}  `)];
}

function formatNestedSchema(schema: Record<string, unknown>, indent: string): string[] {
  const lines: string[] = [];

  if (Array.isArray(schema.anyOf)) {
    lines.push(...formatVariants("anyOf", schema.anyOf, indent));
  }
  if (Array.isArray(schema.oneOf)) {
    lines.push(...formatVariants("oneOf", schema.oneOf, indent));
  }
  if (schema.items !== undefined) {
    lines.push(...formatProperty("items", schema.items, false, indent));
  }
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    const required = Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === "string") : [];
    for (const [name, propSchema] of Object.entries(schema.properties as Record<string, unknown>)) {
      lines.push(...formatProperty(name, propSchema, required.includes(name), indent));
    }
  }

  return lines;
}

function formatVariants(keyword: "anyOf" | "oneOf", variants: unknown[], indent: string): string[] {
  const lines = [`${indent}${keyword}:`];

  for (const variant of variants) {
    if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
      lines.push(`${indent}  - ${JSON.stringify(variant)}`);
      continue;
    }

    const s = variant as Record<string, unknown>;
    const typeStr = formatType(s) || "schema";
    const parts = [`${indent}  - ${typeStr}`];
    appendSchemaAnnotations(parts, s);
    lines.push(parts.join(" "));
    lines.push(...formatNestedSchema(s, `${indent}    `));
  }

  return lines;
}

function formatType(schema: Record<string, unknown>): string {
  if (Object.hasOwn(schema, "const")) {
    return `const ${JSON.stringify(schema.const)}`;
  }

  if (Array.isArray(schema.enum)) {
    return `enum: ${schema.enum.map(v => JSON.stringify(v)).join(", ")}`;
  }

  if (Array.isArray(schema.type)) {
    return schema.type.map(type => String(type)).join(" | ");
  }

  if (schema.type) {
    return String(schema.type);
  }

  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    return "object";
  }

  if (schema.items !== undefined) {
    return "array";
  }

  return "";
}

function appendSchemaAnnotations(parts: string[], schema: Record<string, unknown>): void {
  if (schema.description && typeof schema.description === "string") {
    parts.push(`- ${schema.description}`);
  }

  for (const key of ["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "format", "pattern"] as const) {
    if (schema[key] !== undefined) {
      parts.push(`[${key}: ${JSON.stringify(schema[key])}]`);
    }
  }

  if (schema.default !== undefined) {
    parts.push(`[default: ${JSON.stringify(schema.default)}]`);
  }
}

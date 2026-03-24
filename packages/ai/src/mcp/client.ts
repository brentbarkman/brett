export interface MCPClient {
  query(resource: string, params: Record<string, unknown>): Promise<unknown>;
}

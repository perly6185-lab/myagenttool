export interface TraceSearchRecord {
  invocationId: string; task: string; agentId: string; projectId: string;
  worktreeId: string; traceId: string; status: string; eventTypes: string[];
  eventIds: string[]; evidenceIds: string[]; applicationIds: string[];
  channelIds: string[]; createdAt: string;
}
export interface TraceSearchResponse {
  records: TraceSearchRecord[];
  nextCursor: string | null;
  total: number;
}

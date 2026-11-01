import { isDocumentAgentError } from '@upstream/document-agent/types';

/** 브리지 고유 오류(Rust `ErrorCode` 와 같은 이름). 상류 `DocumentAgentError` 는 코드 그대로 통과시킨다. */
export type AgentBridgeErrorCode =
  | 'DOCUMENT_CHANGED'
  | 'FILE_CHANGED_ON_DISK'
  | 'DOCUMENT_ENCRYPTED'
  | 'BAD_REQUEST'
  | 'SAVE_PATH_REQUIRED'
  | 'SNAPSHOT_NOT_FOUND';

export class AgentBridgeError extends Error {
  constructor(
    readonly code: AgentBridgeErrorCode,
    message: string,
    readonly state?: unknown,
  ) {
    super(message);
    this.name = 'AgentBridgeError';
  }
}

export interface WireError {
  code: string;
  message: string;
  state?: unknown;
}

export function toWireError(error: unknown): WireError {
  if (error instanceof AgentBridgeError) {
    return error.state === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, state: error.state };
  }
  if (isDocumentAgentError(error)) return { code: error.code, message: error.message };
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}

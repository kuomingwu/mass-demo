// 稽核儲存（唯讀附加；示範用記憶體實作）
import type { Action } from '../auth/types';

export interface AuditEvent {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  /** 受影響主體（例如被指派角色者）；無則與 actor 相同 */
  principalId: string;
  principalName: string;
  action: Action | string;
  scope: string;
  tenantId: string | null;
  decision: 'allow' | 'deny';
  requestId: string;
  /** zh-TW 原因（測試用；UI 在有 reasonKey 時優先顯示翻譯） */
  reason?: string;
  /** 可翻譯的原因鍵（src/i18n/dict/<locale>/server.ts）與插補參數 */
  reasonKey?: string;
  reasonParams?: Record<string, string | number | boolean | null | undefined>;
  before?: unknown;
  after?: unknown;
  resourceType?: string;
  resourceId?: string;
}

let counter = 1000;

export function newRequestId(): string {
  counter += 1;
  const rand = Math.random().toString(16).slice(2, 8);
  return `req-${Date.now().toString(36)}-${counter.toString(36)}-${rand}`;
}

export class AuditStore {
  private events: AuditEvent[] = [];

  append(e: Omit<AuditEvent, 'id' | 'timestamp'> & { timestamp?: string }): AuditEvent {
    const ev: AuditEvent = {
      ...e,
      id: `aud-${(this.events.length + 1).toString().padStart(6, '0')}`,
      timestamp: e.timestamp ?? new Date().toISOString(),
    };
    this.events.push(Object.freeze(ev) as AuditEvent);
    return ev;
  }

  all(): readonly AuditEvent[] {
    return this.events;
  }
}

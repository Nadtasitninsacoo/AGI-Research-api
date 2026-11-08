
export type PostAccessSessionStatus =
  | "PENDING"
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED";

export type PostAccessTaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type PostAccessTaskCategory =
  | "SYSTEM_INVENTORY"
  | "SECURITY_CONFIGURATION_AUDIT"
  | "LOCAL_NETWORK_INVENTORY"
  | "PERMISSION_AUDIT"
  | "AGENT_HEALTH_CHECK"
  | "EVIDENCE_INTEGRITY_CHECK";

export type PostAccessRiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH";

export interface PostAccessSession {
  id: string;
  runId: string;
  scopeId: string;
  status: PostAccessSessionStatus;
  createdAt: Date;
  expiresAt: Date;
  activatedAt: Date | null;
  terminatedAt: Date | null;
}

export interface PostAccessTask {
  id: string;
  sessionId: string;
  taskKey: string;
  category: PostAccessTaskCategory;
  status: PostAccessTaskStatus;
  riskLevel: PostAccessRiskLevel;
  requestedAt: Date;
  completedAt: Date | null;
}

export interface PostAccessEvidence {
  id: string;
  sessionId: string;
  taskId: string;
  evidenceType: string;
  sha256: string;
  collectedAt: Date;
  verified: boolean;
}

export interface ScopeAuthorization {
  scopeId: string;
  enabled: boolean;
  validFrom: Date;
  expiresAt: Date;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  checkedAt: Date;
}

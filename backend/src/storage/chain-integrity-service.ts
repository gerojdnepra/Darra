import type {
  DecisionChainIntegrityRecord,
  DecisionChainIntegrityStatus,
  DecisionChainMissingLink
} from "../types/messages";
import {
  decisionChainIntegrityRepository,
  type DecisionChainIntegrityRepository
} from "./decision-chain-integrity-repository";
import {
  reconstructDecisionChain,
  type ReconstructDecisionChainInput
} from "./decision-chain-repository";

export interface CheckDecisionChainIntegrityInput extends ReconstructDecisionChainInput {
  checkedAt?: number;
  source: string;
}

const degradedOnlyLinks = new Set<DecisionChainMissingLink>([
  "UNIFIED_SIGNAL",
  "DECISION_REVIEW"
]);

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const resolveStatus = (
  missingLinks: DecisionChainMissingLink[]
): DecisionChainIntegrityStatus => {
  if (missingLinks.length === 0) {
    return "COMPLETE";
  }

  if (missingLinks.every((link) => degradedOnlyLinks.has(link))) {
    return "DEGRADED";
  }

  return "BROKEN";
};

export class ChainIntegrityService {
  constructor(
    private readonly integrityRepository: DecisionChainIntegrityRepository =
      decisionChainIntegrityRepository
  ) {}

  checkChain(input: CheckDecisionChainIntegrityInput): DecisionChainIntegrityRecord {
    const chain = reconstructDecisionChain(input);
    const missingLinks: DecisionChainMissingLink[] = [];

    if (!chain.unifiedSignal) {
      missingLinks.push("UNIFIED_SIGNAL");
    }
    if (!chain.tradeDecisionContext) {
      missingLinks.push("DECISION_CONTEXT");
    }
    if (!chain.orderIntent) {
      missingLinks.push("ORDER_INTENT");
    }
    if (!chain.executionCommand) {
      missingLinks.push("EXECUTION_COMMAND");
    }
    if (!chain.executionResult) {
      missingLinks.push("EXECUTION_RESULT");
    }
    if (!chain.positionLifecycle) {
      missingLinks.push("POSITION_LIFECYCLE");
    }
    if (!chain.decisionReview) {
      missingLinks.push("DECISION_REVIEW");
    }

    const record = this.integrityRepository.createRecord({
      lifecycleId: normalizeText(chain.positionLifecycleId),
      reviewId: normalizeText(chain.reviewId) ?? normalizeText(chain.decisionReview?.id),
      orderIntentId:
        normalizeText(chain.positionLifecycle?.orderIntentId) ??
        normalizeText(chain.tradeDecisionContext?.orderIntentId) ??
        (chain.orderIntent && typeof chain.orderIntent === "object" && "intentId" in chain.orderIntent
          ? normalizeText((chain.orderIntent as { intentId?: string | null }).intentId)
          : null),
      decisionContextId:
        normalizeText(chain.tradeDecisionContext?.id) ??
        normalizeText(chain.positionLifecycle?.decisionContextId) ??
        normalizeText(chain.decisionReview?.decisionContextId),
      unifiedSignalId:
        normalizeText(chain.unifiedSignal?.id) ??
        normalizeText(chain.tradeDecisionContext?.unifiedSignalId) ??
        normalizeText(chain.positionLifecycle?.unifiedSignalId) ??
        normalizeText(chain.decisionReview?.unifiedSignalId),
      status: resolveStatus(missingLinks),
      missingLinks,
      source: input.source,
      ...(typeof input.checkedAt === "number" && Number.isFinite(input.checkedAt)
        ? { checkedAt: input.checkedAt }
        : {})
    });

    console.log("DECISION_CHAIN_INTEGRITY_CHECKED", {
      integrityId: record.id,
      lifecycleId: record.lifecycleId ?? null,
      reviewId: record.reviewId ?? null,
      status: record.status,
      missingLinks: record.missingLinks,
      source: record.source,
      checkedAt: record.checkedAt
    });

    return record;
  }
}

export const chainIntegrityService = new ChainIntegrityService();

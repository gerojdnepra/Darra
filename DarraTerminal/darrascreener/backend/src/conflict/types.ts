export interface ConflictSignalAgreement {
  risk: number;
  funding: number;
  flow: number;
  liquidation: number;
  regime: number;
}

export interface ConflictState {
  symbol: string;
  conflictIndex: number;
  consensusScore: number;
  alignmentScore: number;
  signalAgreement: ConflictSignalAgreement;
  adjustedConfidence: number;
}

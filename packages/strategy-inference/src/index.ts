export { computeFingerprints, type Fingerprints } from "./fingerprints.js";
export { inferFromEvidence, scoreFamilies, familyLabel, CONFIDENCE_NOTE, type InferenceInput, type EvidenceWindow } from "./infer.js";
export {
  runZeroGInference,
  gateProposal,
  buildEvidencePack,
  type EvidencePack,
  type ZeroGConfig,
  type ZeroGResult,
  type InferenceRun,
} from "./zero-g.js";

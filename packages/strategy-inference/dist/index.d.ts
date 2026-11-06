export { computeFingerprints, computePriceResponse, isFullRangeLike, type Fingerprints } from "./fingerprints.js";
export { inferFromEvidence, scoreFamilies, familyLabel, CONFIDENCE_NOTE, type InferenceInput, type EvidenceWindow } from "./infer.js";
export { runZeroGInference, gateProposal, buildEvidencePack, type EvidencePack, type ZeroGConfig, type ZeroGResult, type InferenceRun, } from "./zero-g.js";
export { buildCaseStudy, type CaseStudy, type CaseStudyInput, type CaseEvent, type CasePosition, type Observation, type RangeChange } from "./case-study.js";

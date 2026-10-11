const mongoose = require('mongoose');

const verificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  initials: String,
  docType: {
    type: String,
    required: true
  },
  docTypeSub: String,
  date: {
    type: Date,
    default: Date.now
  },
  confidence: {
    type: Number
  },
  status: {
    type: String,
    // 'Suspicious' added in Phase 9 (purely additive - existing
    // documents already use values within this expanded set, so this
    // does not invalidate any prior record). Phase 9 is the first phase
    // allowed to move status away from 'Pending'; see `decision` below
    // for the mapping.
    enum: ['Approved', 'Pending', 'Rejected', 'Suspicious'],
    default: 'Pending'
  },
  details: {
    faceMatch: String,
    forgeryDetection: String,
    documentStatus: String,
    extractedName: String,
    extractedAddress: String
  },
  originalFilename: String,
  identityFile: String,
  supportingFiles: [String],

  // Phase 6: raw OCR text only (EasyOCR), newline-joined. No structured
  // fields (name/number/DOB) are derived or stored here - that is
  // Phase 7 (Groq). Per-detection confidence is returned in the API
  // response but not persisted; it isn't a single meaningful
  // record-level number.
  ocrText: String,

  // Phase 7: structured fields Groq derived from ocrText. `fields` is
  // Mixed rather than dozens of top-level columns because PAN/Aadhaar/
  // Passport each have a different field set. No fraud/GNN/approval
  // fields here - those are later phases. This is still not a KYC
  // decision; `status` above stays independent of this.
  extractedData: {
    documentType: String,
    extractionStatus: String,
    fields: mongoose.Schema.Types.Mixed
  },

  // Phase 8: graph-based anomaly/RISK SIGNAL only - never a fraud
  // verdict or KYC decision. anomalyScore is a deterministic
  // graph-statistics heuristic (shared-identifier detection across
  // records), not a trained/statistically validated classifier - no
  // labeled fraud dataset exists. `status` above is untouched by this;
  // final KYC decisions are a later phase. See ml-service/README.md.
  graphAnalysis: {
    status: String, // success | insufficient_data | not_applicable | error
    anomalyScore: Number,
    riskLevel: String, // low | medium | high
    signals: [String],
    graphFeatures: mongoose.Schema.Types.Mixed
  },

  // Phase 9: deterministic final KYC decision - a rules engine reading
  // the Phase 5-8 results above, NOT a new model/score. `status` here is
  // the decision engine's own status (success/pending/error), distinct
  // from the Verification-level `status` field above (Pending/Approved/
  // Suspicious/Rejected). The mapping: decision.status==='success' sets
  // the top-level `status` to match decision.decision (capitalized);
  // decision.status in ('pending','error') leaves top-level `status`
  // untouched (stays 'Pending') - a processing failure or insufficient
  // evidence never becomes Approved/Rejected/Suspicious.
  decision: {
    status: String, // success | pending | error
    decision: String, // approved | suspicious | rejected | null
    reasons: [String],
    ruleVersion: String
  }
});

module.exports = mongoose.model('Verification', verificationSchema);

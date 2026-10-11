const fs = require('fs');
const Verification = require('../models/Verification');
const mlService = require('../services/mlService');
const { hashIdentityFields } = require('../services/identityHash');

const getInitials = (name) => {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.map((p) => p[0].toUpperCase()).join('');
};

const removeFiles = (files) => {
  files.forEach((f) => fs.unlink(f.path, () => {}));
};

exports.verifyDocuments = async (req, res) => {
  const identityFile = req.files && req.files['identity'] ? req.files['identity'][0] : null;
  const supportingFiles = (req.files && req.files['supporting']) || [];

  if (!identityFile) {
    // Multer already wrote any supporting files to disk before this
    // validation runs - clean them up rather than leaving orphans.
    removeFiles(supportingFiles);
    return res.status(400).json({
      success: false,
      message: 'Identity document is required'
    });
  }

  let verification;
  try {
    verification = await Verification.create({
      user: req.user.id,
      name: req.user.name,
      initials: getInitials(req.user.name),
      docType: 'Pending Classification',
      originalFilename: identityFile.originalname,
      status: 'Pending',
      identityFile: identityFile.path,
      supportingFiles: supportingFiles.map((f) => f.path)
    });
  } catch (err) {
    // The files are already saved to disk at this point - if the DB
    // write fails, don't leave them orphaned with no record.
    removeFiles([identityFile, ...supportingFiles]);
    console.error('Verification creation error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Could not save verification record. Please try again.'
    });
  }

  // Phase 8: gather OTHER users' already-extracted identifiers, hashed
  // here (never raw) before anything leaves this process, so Flask never
  // sees another user's raw PAN/Aadhaar/passport/name value - only the
  // current request's own document bytes and these hashes.
  let existingIdentities = [];
  try {
    const priorRecords = await Verification.find({
      _id: { $ne: verification._id },
      'extractedData.fields': { $exists: true }
    })
      .select('user extractedData.fields')
      .lean();

    existingIdentities = priorRecords
      .map((r) => ({
        verificationId: r._id.toString(),
        userId: r.user ? r.user.toString() : null,
        hashes: hashIdentityFields(r.extractedData && r.extractedData.fields)
      }))
      .filter((r) => Object.keys(r.hashes).length > 0);
  } catch (err) {
    // Graph input is best-effort - if this lookup fails, proceed with an
    // empty set rather than failing the whole upload. Flask will then
    // correctly report graphAnalysis.status = "insufficient_data".
    console.error('Could not load prior records for graph analysis:', err.message);
  }

  // Best-effort contact with the ML service. The upload has already
  // succeeded (file saved, record created) by this point, so a
  // down/unreachable ML service - or one that cleanly rejects this
  // particular file (unsupported PDF, corrupted image, model not loaded)
  // - does not fail the request. It just means classification didn't
  // happen yet; the record stays exactly as it was.
  const ml = await mlService.classifyDocument(
    identityFile.path,
    identityFile.originalname,
    identityFile.mimetype,
    req.user.id,
    existingIdentities
  );

  const mlSucceeded = ml.reachable && ml.status === 200 && ml.result && ml.result.success === true;
  const classified = mlSucceeded ? ml.result.result : null;
  const ocrResult = mlSucceeded ? ml.result.ocr : null;
  const extraction = mlSucceeded ? ml.result.extraction : null;
  const graphAnalysis = mlSucceeded ? ml.result.graphAnalysis : null;
  const decisionResult = mlSucceeded ? ml.result.decision : null;

  if (classified) {
    // Real CNN classification result. This is NOT a KYC decision - it
    // only identifies the document type. status stays 'Pending'; nothing
    // here ever sets Approved/Rejected. docType/confidence already existed
    // on the schema from Phase 4A, so no schema change was needed.
    verification.docType = classified.document_class;
    verification.confidence = classified.confidence;
  }

  if (ocrResult) {
    // Raw text only - structured extraction is handled separately below.
    verification.ocrText = ocrResult.raw_text || '';
  }

  if (extraction) {
    // Structured fields from Groq (Phase 7) - still not a KYC decision.
    // extraction_status reflects how much was found, never Approved/Rejected.
    verification.extractedData = {
      documentType: extraction.document_type,
      extractionStatus: extraction.extraction_status,
      fields: extraction.fields || {}
    };
  }

  if (graphAnalysis) {
    // Graph-based anomaly/risk SIGNAL only - never a KYC decision. status
    // above stays 'Pending' regardless of riskLevel. Not a fraud score;
    // not Approved/Rejected. See ml-service/README.md.
    verification.graphAnalysis = {
      status: graphAnalysis.status,
      anomalyScore: graphAnalysis.anomalyScore,
      riskLevel: graphAnalysis.riskLevel,
      signals: graphAnalysis.signals || [],
      graphFeatures: graphAnalysis.graphFeatures || {}
    };
  }

  // Phase 9: deterministic decision engine output. Only ever MOVES
  // `status` away from 'Pending' when the decision engine itself reached
  // a real decision (decisionResult.status === 'success'). A processing
  // failure or insufficient evidence ('pending'/'error') leaves `status`
  // untouched - never silently becomes Approved.
  const DECISION_TO_STATUS = { approved: 'Approved', suspicious: 'Suspicious', rejected: 'Rejected' };
  if (decisionResult) {
    verification.decision = {
      status: decisionResult.status,
      decision: decisionResult.decision,
      reasons: decisionResult.reasons || [],
      ruleVersion: decisionResult.ruleVersion
    };

    if (decisionResult.status === 'success' && DECISION_TO_STATUS[decisionResult.decision]) {
      verification.status = DECISION_TO_STATUS[decisionResult.decision];
    }
  }

  if (classified || ocrResult || extraction || graphAnalysis || decisionResult) {
    await verification.save();
  }

  return res.status(201).json({
    success: true,
    message: 'Document uploaded successfully',
    data: {
      verification: {
        id: verification._id,
        status: verification.status.toLowerCase(),
        filename: verification.originalFilename,
        docType: verification.docType,
        confidence: verification.confidence ?? null,
        submittedAt: verification.date
      },
      ocr: ocrResult
        ? {
            hasText: ocrResult.has_text,
            rawText: ocrResult.raw_text,
            detections: ocrResult.detections
          }
        : null,
      extraction: extraction
        ? {
            documentType: extraction.document_type,
            extractionStatus: extraction.extraction_status,
            fields: extraction.fields
          }
        : null,
      graphAnalysis: graphAnalysis || null,
      decision: decisionResult || null,
      mlService: {
        connected: ml.reachable,
        mock: ml.reachable && ml.result ? !!ml.result.mock : null
      }
    }
  });
};

// Escapes regex metacharacters so a user-supplied search string is
// matched literally (e.g. a name containing "." or "(" can't alter the
// pattern's meaning or be used to build an unintended/expensive regex).
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.getHistory = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';

    // DB-level ownership filter, not a post-fetch hide: a Normal User's
    // query is scoped to their own records exactly as before this
    // feature; only an admin's query is left unrestricted. The optional
    // ?name= search param below is likewise only ever honored for an
    // admin - a Normal User supplying it has no effect, since their
    // results are already restricted to their own records regardless of
    // any name/id value they pass.
    const filter = isAdmin ? {} : { user: req.user.id };

    if (isAdmin && req.query.name) {
      const raw = String(req.query.name).trim();
      if (raw) {
        filter.name = new RegExp(escapeRegex(raw), 'i');
      }
    }

    const verifications = await Verification.find(filter).sort('-date');

    const data = verifications.map((v) => ({
      id: v._id,
      name: v.name,
      initials: v.initials,
      docType: v.docType,
      filename: v.originalFilename,
      status: v.status.toLowerCase(),
      confidence: v.confidence ?? null,
      submittedAt: v.date
    }));

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });
  } catch (err) {
    console.error('Get history error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Could not load verification history.'
    });
  }
};

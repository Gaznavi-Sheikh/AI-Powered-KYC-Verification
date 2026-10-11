import React, { useState, useRef, useEffect } from "react";
import DashboardLayout from "./DashboardLayout";
import { kycApi } from "../services/api";
import { useAuth } from "../context/AuthContext";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SUPPORTING_FILES = 5;
const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf"];
const SENSITIVE_FIELDS = new Set(["pan_number", "aadhaar_number", "passport_number"]);

const PIPELINE_STAGES = [
  {
    id: "classification",
    label: "Document classification",
    sub: "CNN/TFLite",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
      </svg>
    )
  },
  {
    id: "ocr",
    label: "Text extraction",
    sub: "EasyOCR",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    )
  },
  {
    id: "extraction",
    label: "Structured data extraction",
    sub: "Groq",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1 2 3.46V13a4 4 0 0 1-2 3.46V18a4 4 0 0 1-8 0v-1.54A4 4 0 0 1 6 13v-2.54A4 4 0 0 1 8 7V6a4 4 0 0 1 4-4z" />
      </svg>
    )
  },
  {
    id: "graph",
    label: "Graph risk analysis",
    sub: "Deterministic NetworkX-based analysis",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" />
        <line x1="6.7" y1="7.2" x2="11" y2="16.3" /><line x1="17.3" y1="7.2" x2="13" y2="16.3" /><line x1="7" y1="6" x2="17" y2="6" />
      </svg>
    )
  },
  {
    id: "decision",
    label: "Final decision",
    sub: "Deterministic KYC decision engine",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5l-8-3z" /><polyline points="9 12 11 14 15 10" />
      </svg>
    )
  }
];

const STATE_LABEL = {
  waiting: "Waiting",
  processing: "Processing",
  completed: "Completed",
  pending: "Pending",
  failed: "Failed",
  skipped: "Skipped"
};

// Derives truthful per-stage pipeline status from the actual verify API
// response (Phase 4A-9 fields) - never fabricated, never advanced just
// because the scanning animation is running. Before a response exists,
// every stage is 'waiting' (idle) or collectively 'processing' (in
// flight) since the backend only reports a single final result, not
// incremental per-stage events.
function getStageStates(aiStatus, result) {
  if (aiStatus === "scanning") {
    return PIPELINE_STAGES.map((s) => ({ ...s, state: "processing" }));
  }
  if (aiStatus !== "results" || !result) {
    return PIPELINE_STAGES.map((s) => ({ ...s, state: "waiting" }));
  }

  const classified = !!(result.verification?.docType && result.verification.docType !== "Pending Classification");
  const states = { classification: classified ? "completed" : "failed" };

  if (!classified) {
    states.ocr = states.extraction = states.graph = states.decision = "skipped";
  } else {
    states.ocr = result.ocr ? "completed" : "skipped";

    const exStatus = result.extraction?.extractionStatus;
    states.extraction = exStatus === "success" || exStatus === "partial"
      ? "completed"
      : exStatus === "no_data"
      ? "pending"
      : exStatus === "error"
      ? "failed"
      : "skipped";

    const gaStatus = result.graphAnalysis?.status;
    states.graph = gaStatus === "success"
      ? "completed"
      : gaStatus === "insufficient_data"
      ? "pending"
      : gaStatus === "error"
      ? "failed"
      : "skipped";

    const decStatus = result.decision?.status;
    states.decision = decStatus === "success" ? "completed" : decStatus === "pending" ? "pending" : decStatus === "error" ? "failed" : "waiting";
  }

  return PIPELINE_STAGES.map((s) => ({ ...s, state: states[s.id] }));
}

const DECISION_DISPLAY = {
  approved: { label: "Approved", className: "approved", note: null },
  suspicious: { label: "Suspicious", className: "suspicious", note: "Automated checks identified a risk signal requiring review." },
  rejected: { label: "Rejected", className: "rejected", note: "Required KYC validation failed." }
};

const EXTRACTION_STATUS_LABEL = {
  success: "Complete",
  partial: "Partial",
  no_data: "No data found",
  error: "Failed",
  not_applicable: "Not applicable"
};

const GRAPH_STATUS_LABEL = {
  insufficient_data: "Insufficient data",
  error: "Unavailable",
  not_applicable: "Not applicable"
};

const fieldLabel = (key) => key.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

const maskValue = (key, value) => {
  const str = String(value);
  if (!SENSITIVE_FIELDS.has(key)) return str;
  if (str.length <= 4) return "••••";
  return "•".repeat(str.length - 4) + str.slice(-4);
};

const formatFileSize = (bytes) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const isAcceptedFile = (file) => {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
};

const CloudUploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 18a4.6 4.4 0 0 1 0-9 5 4.5 0 0 1 9.8-1.5A4.5 4.5 0 0 1 18 18H7Z" />
    <path d="M12 12v7" /><path d="m9 15 3-3 3 3" />
  </svg>
);

const DocFileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

function IdentityDropzone({ file, onPick, onRemove, disabled, inputRef }) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [fileError, setFileError] = useState("");

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const validateAndPick = (candidate) => {
    if (!candidate) return;
    if (!isAcceptedFile(candidate)) {
      setFileError("Unsupported file type. Please upload a PNG, JPG or PDF.");
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      setFileError("File is too large. Maximum size is 5MB.");
      return;
    }
    setFileError("");
    onPick(candidate);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files?.length) validateAndPick(e.dataTransfer.files[0]);
  };

  return (
    <div className="dash-card dash-card-compact">
      <div className="card-label-row">
        <span className="card-label-text">Identity document</span>
        <span className="field-badge required">Required</span>
      </div>
      <p className="card-helper-text">PNG, JPG or PDF · Maximum 5 MB</p>

      <input
        type="file"
        ref={inputRef}
        onChange={(e) => e.target.files?.[0] && validateAndPick(e.target.files[0])}
        accept={ACCEPTED_EXTENSIONS.join(",")}
        style={{ display: "none" }}
        disabled={disabled}
      />

      {fileError && <p className="field-error-text">{fileError}</p>}

      {file ? (
        <div className="file-chip">
          {previewUrl ? (
            <img src={previewUrl} alt="" className="file-chip-thumb" />
          ) : (
            <div className="file-chip-icon"><DocFileIcon /></div>
          )}
          <div className="file-chip-info">
            <div className="file-chip-name">{file.name}</div>
            <div className="file-chip-meta">{formatFileSize(file.size)} · Ready to process</div>
          </div>
          {!disabled && (
            <button type="button" className="btn-remove" onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      ) : (
        <div
          className={`drop-zone ${isDragging ? "drag-over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          onDrop={handleDrop}
          onClick={() => !disabled && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Upload identity document"
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !disabled) { e.preventDefault(); inputRef.current?.click(); } }}
        >
          <div className="drop-zone-icon"><CloudUploadIcon /></div>
          <div className="drop-zone-text">Upload your identity document</div>
          <div className="drop-zone-or">Drag and drop your file here, or browse your device.</div>
          <button
            type="button"
            className="btn-browse"
            onClick={(e) => { e.stopPropagation(); if (!disabled) inputRef.current?.click(); }}
            disabled={disabled}
          >
            Browse files
          </button>
        </div>
      )}
    </div>
  );
}

function SupportingDropzone({ files, onAdd, onRemove, disabled, inputRef }) {
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const room = MAX_SUPPORTING_FILES - files.length;

  const handleFiles = (list) => {
    const incoming = Array.from(list);
    if (room <= 0) {
      setFileError(`You can attach up to ${MAX_SUPPORTING_FILES} supporting documents.`);
      return;
    }
    const valid = [];
    for (const f of incoming) {
      if (!isAcceptedFile(f)) { setFileError("Unsupported file type. Please upload PNG, JPG or PDF."); continue; }
      if (f.size > MAX_FILE_BYTES) { setFileError("One of the files is too large. Maximum size is 5MB."); continue; }
      valid.push(f);
      if (valid.length >= room) break;
    }
    if (valid.length) {
      setFileError("");
      onAdd(valid);
    }
  };

  const openPicker = () => !disabled && room > 0 && inputRef.current?.click();

  return (
    <div className={`dash-card dash-card-compact ${disabled ? "card-disabled" : ""}`}>
      <div className="card-label-row">
        <span className="card-label-text">Supporting documents</span>
        <span className="field-badge optional">Optional</span>
      </div>
      <p className="card-helper-text">Address proof, utility bills, etc.</p>

      <input
        type="file"
        multiple
        ref={inputRef}
        onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
        accept={ACCEPTED_EXTENSIONS.join(",")}
        style={{ display: "none" }}
        disabled={disabled}
      />

      {fileError && <p className="field-error-text">{fileError}</p>}

      {room > 0 && (
        <div
          className={`supporting-add-row ${isDragging ? "drag-over" : ""}`}
          onClick={openPicker}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (!disabled && e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files); }}
          role="button"
          tabIndex={0}
          aria-label="Add supporting documents"
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !disabled) { e.preventDefault(); openPicker(); } }}
        >
          <span className="supporting-add-row-icon"><CloudUploadIcon /></span>
          <span className="supporting-add-row-text">Add supporting docs</span>
          <button type="button" className="btn-browse" onClick={(e) => { e.stopPropagation(); openPicker(); }} disabled={disabled}>
            Browse
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className="supporting-file-list">
          {files.map((file, idx) => (
            <div key={`${file.name}-${idx}`} className="supporting-file-row">
              <span className="supporting-file-name">{file.name}</span>
              <span className="supporting-file-size">{formatFileSize(file.size)}</span>
              {!disabled && (
                <button type="button" className="btn-remove-icon" onClick={() => onRemove(idx)} aria-label={`Remove ${file.name}`}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PipelinePanel({ aiStatus, result, uploadError, hasFile }) {
  const stages = getStageStates(aiStatus, result);
  const decisionInfo = aiStatus === "results" && result?.decision?.status === "success" && result.decision.decision
    ? DECISION_DISPLAY[result.decision.decision]
    : null;
  const isPending = aiStatus === "results" && result && !decisionInfo;

  const extractionFields = result?.extraction?.fields
    ? Object.entries(result.extraction.fields).filter(([, v]) => v !== null && v !== undefined && v !== "")
    : [];

  const isResults = aiStatus === "results" && result;

  return (
    <div className="dash-card dash-card-compact pipeline-card">
      {isResults ? (
        <div className="decision-panel fade-in">
          <div className={`decision-banner ${decisionInfo ? decisionInfo.className : "pending"}`}>
            {decisionInfo ? decisionInfo.label.toUpperCase() : "PENDING"}
          </div>
          {decisionInfo?.note && <p className="decision-note">{decisionInfo.note}</p>}
          {isPending && (
            <p className="decision-note">
              {result.decision?.status === "error"
                ? "A processing stage failed, so no automated decision could be reached."
                : "KYC verification is pending because sufficient automated evidence is not available."}
            </p>
          )}

          <div className="info-grid">
            <div className="info-cell">
              <span className="info-label">Document type</span>
              <span className="info-value">{result.verification?.docType || "Not available"}</span>
            </div>
            <div className="info-cell">
              <span className="info-label">Confidence level</span>
              <span className="info-value">
                {result.verification?.confidence != null
                  ? `${(result.verification.confidence * 100).toFixed(1)}% (document classification)`
                  : "Not available"}
              </span>
            </div>
            <div className="info-cell">
              <span className="info-label">Extraction status</span>
              <span className="info-value">
                {result.extraction?.extractionStatus ? (EXTRACTION_STATUS_LABEL[result.extraction.extractionStatus] || result.extraction.extractionStatus) : "Not available"}
              </span>
            </div>
            <div className="info-cell">
              <span className="info-label">Graph risk level</span>
              <span className="info-value">
                {result.graphAnalysis?.riskLevel
                  ? result.graphAnalysis.riskLevel.charAt(0).toUpperCase() + result.graphAnalysis.riskLevel.slice(1)
                  : (GRAPH_STATUS_LABEL[result.graphAnalysis?.status] || "Not available")}
              </span>
            </div>
            <div className="info-cell info-cell-wide">
              <span className="info-label">Risk signals</span>
              <span className="info-value">
                {result.graphAnalysis?.signals?.length ? result.graphAnalysis.signals.join("; ") : "None reported"}
              </span>
            </div>
            <div className="info-cell info-cell-wide">
              <span className="info-label">Decision reasons</span>
              <span className="info-value">
                {result.decision?.reasons?.length ? result.decision.reasons.join("; ") : "Not available"}
              </span>
            </div>
          </div>

          {extractionFields.length > 0 && (
            <div className="extracted-fields">
              <span className="info-label">Extracted information</span>
              <div className="extracted-fields-list">
                {extractionFields.map(([key, value]) => (
                  <div key={key} className="result-row">
                    <span className="result-label">{fieldLabel(key)}</span>
                    <span className="result-value">{maskValue(key, value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <h2 className="pipeline-title">AI verification pipeline</h2>
          <p className="pipeline-subtitle">Your document is checked through these automated stages.</p>

          {aiStatus === "idle" && !hasFile && (
            <div className="pipeline-idle-prompt">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
              <span>Upload a document to begin.</span>
            </div>
          )}

          <ol className="pipeline-timeline">
            {stages.map((stage) => (
              <li key={stage.id} className={`pipeline-stage state-${stage.state}`}>
                <span className="pipeline-stage-icon">{stage.icon}</span>
                <div className="pipeline-stage-info">
                  <span className="pipeline-stage-label">{stage.label}</span>
                  <span className="pipeline-stage-sub">{stage.sub}</span>
                </div>
                <span className={`status-pill ${stage.state}`}>{STATE_LABEL[stage.state]}</span>
              </li>
            ))}
          </ol>

          <p className="pipeline-footnote">Results will appear here once your document has been analyzed.</p>
        </>
      )}

      {uploadError && <p className="field-error-text" role="alert">{uploadError}</p>}
    </div>
  );
}

const Upload = () => {
  const { token } = useAuth();

  const [mainFile, setMainFile] = useState(null);
  const [supportingFiles, setSupportingFiles] = useState([]);
  const [aiStatus, setAiStatus] = useState("idle"); // idle | scanning | results
  const [result, setResult] = useState(null);
  const [uploadError, setUploadError] = useState("");

  const fileInputRef = useRef(null);
  const supportingInputRef = useRef(null);

  const uiStep = aiStatus === "idle" ? "upload" : aiStatus === "scanning" ? "analyze" : "results";

  const handlePickMain = (file) => {
    setMainFile(file);
    setUploadError("");
  };

  const handleRemoveMain = () => {
    setMainFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAddSupporting = (files) => {
    setSupportingFiles((prev) => [...prev, ...files]);
  };

  const handleRemoveSupporting = (index) => {
    setSupportingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleStartNew = () => {
    setMainFile(null);
    setSupportingFiles([]);
    setAiStatus("idle");
    setResult(null);
    setUploadError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (supportingInputRef.current) supportingInputRef.current.value = "";
  };

  const handleStartVerification = async () => {
    if (!mainFile) return;
    setUploadError("");
    setAiStatus("scanning");

    try {
      const { ok, data } = await kycApi.verify(token, mainFile, supportingFiles);

      if (!ok || !data.success) {
        setUploadError(data.message || "Upload failed. Please try again.");
        setAiStatus("idle");
        return;
      }

      setResult(data.data);
      setAiStatus("results");
    } catch (err) {
      setUploadError(`Unable to reach the server: ${err.message}`);
      setAiStatus("idle");
    }
  };

  const isBusy = aiStatus === "scanning";

  return (
    <DashboardLayout>
      <div className="page-header page-header-compact">
        <h1>New verification</h1>
      </div>

      <div className="verify-steps" role="list" aria-label="Verification progress">
        {[["upload", "01 — Upload"], ["analyze", "02 — Analyze"], ["results", "03 — Results"]].map(([id, label], idx, arr) => (
          <React.Fragment key={id}>
            <span className={`verify-step ${uiStep === id ? "active" : ""}`}>{label}</span>
            {idx < arr.length - 1 && <span className="verify-step-sep">—</span>}
          </React.Fragment>
        ))}
      </div>

      <div className="upload-grid">
        <div className="upload-col">
          <IdentityDropzone
            file={mainFile}
            onPick={handlePickMain}
            onRemove={handleRemoveMain}
            disabled={isBusy}
            inputRef={fileInputRef}
          />

          <SupportingDropzone
            files={supportingFiles}
            onAdd={handleAddSupporting}
            onRemove={handleRemoveSupporting}
            disabled={isBusy}
            inputRef={supportingInputRef}
          />

          {aiStatus === "idle" && (
            <button className="btn-primary btn-start" onClick={handleStartVerification} disabled={!mainFile}>
              Start verification
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </button>
          )}
          {aiStatus === "scanning" && (
            <div className="processing-card fade-in">
              <div className="processing-row">
                <span className="spinner" aria-hidden="true" />
                <span className="processing-text">Analyzing <strong>{mainFile?.name}</strong>…</span>
              </div>
              <div className="indeterminate-bar" />
              <button className="btn-primary btn-start" disabled>Processing verification…</button>
            </div>
          )}
          {aiStatus === "results" && (
            <button className="btn-primary btn-start btn-secondary-style" onClick={handleStartNew}>
              Start new verification
            </button>
          )}
        </div>

        <PipelinePanel aiStatus={aiStatus} result={result} uploadError={aiStatus === "idle" ? uploadError : ""} hasFile={!!mainFile} />
      </div>
    </DashboardLayout>
  );
};

export default Upload;

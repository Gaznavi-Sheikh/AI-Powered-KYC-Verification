RULE_VERSION = '1.0'

# Minimum fields required to consider extraction "sufficient to decide."
# These are a deliberate policy choice for THIS phase, not inherited from
# extractor.py's SCHEMAS (which lists every field worth attempting to
# extract, not which ones are mandatory for a decision). The field NAMES
# themselves are exactly extractor.py's - no new field vocabulary.
# Passport's name requirement (surname OR given_name) is handled specially
# in _missing_required_fields() since passport has no single 'name' field.
REQUIRED_FIELDS = {
    'pan': ['name', 'pan_number'],
    'aadhaar': ['name', 'aadhaar_number'],
    'passport': ['passport_number']
}

# Because extractor.py's _validate_field() already nulls out any
# PAN/Aadhaar number that fails its deterministic format regex before it
# ever reaches this module, "field is null here" already means EITHER
# "OCR never found it" OR "OCR found it but Phase 7 rejected the format."
# Either way the operative fact is the same: no valid value is available.
# Re-implementing PAN_RE/AADHAAR_RE here would duplicate Phase 7's
# validation for no benefit - deliberately not done.


def _result(status, decision, reasons):
    return {
        'status': status,
        'decision': decision,
        'reasons': reasons,
        'ruleVersion': RULE_VERSION
    }


def _missing_required_fields(doc_type, fields):
    missing = [f for f in REQUIRED_FIELDS.get(doc_type, []) if not fields.get(f)]
    if doc_type == 'passport' and not (fields.get('surname') or fields.get('given_name')):
        missing.append('name')
    return missing


def _has_strong_graph_signal(graph_analysis):
    """
    Reads graph.py's EXISTING signals list rather than re-deriving
    strong-vs-weak logic here (Step 11: "do not invent new graph logic
    unless absolutely necessary"). graph.py always phrases a strong
    (PAN/Aadhaar/passport) match starting with "A strong identifier" -
    this is an intentional, minimal contract between the two modules,
    not a coincidence. A high riskLevel is NOT used directly as a proxy
    for "strong match", because enough weak (name-only) matches could
    mathematically reach the same riskLevel threshold on their own -
    checking the signal text directly avoids that false equivalence.

    Matches on a STARTSWITH prefix, not a bare substring: graph.py's weak
    signal reads "...with no strong identifier match", which would
    wrongly match a naive `"strong identifier" in s` check - this is
    exactly the false-equivalence bug this function exists to avoid.
    """
    signals = graph_analysis.get('signals') or []
    return any(s.lower().startswith('a strong identifier') for s in signals)


def decide(document_class, confidence, ocr_payload, extraction, graph_analysis):
    """
    Deterministic, rule-based final KYC decision. Consumes only the
    results already produced earlier in THIS SAME /predict call - never
    calls the CNN, OCR, Groq, or graph analysis again.

    Returns {"status", "decision", "reasons", "ruleVersion"}:
      status:
        "success" - a real decision was reached (decision is non-null)
        "pending" - insufficient evidence to decide (decision is null)
        "error"   - a processing stage failed (decision is null)
      decision: "approved" | "suspicious" | "rejected" | null

    Same inputs always produce the same output - no randomness, no
    network calls, no model inference.
    """
    # Defensive only - in the live app.py flow, decision.decide() is only
    # ever called after classifier/extraction/graph have already
    # produced real dicts in the same request. Kept for standalone
    # testability and robustness, not because this path is reachable
    # from app.py today.
    if document_class is None or extraction is None or graph_analysis is None:
        return _result('error', None, ['Automated verification could not be completed'])

    doc_type = extraction.get('document_type')
    extraction_status = extraction.get('extraction_status')
    fields = extraction.get('fields') or {}
    graph_status = graph_analysis.get('status')

    # Non-KYC is a CONFIDENT rejection, not a processing gap - the CNN
    # gave a real, decisive answer.
    if doc_type == 'non_kyc':
        return _result('success', 'rejected', ['Document was classified as a non-KYC document'])

    if doc_type not in REQUIRED_FIELDS:
        # Safety net only - CNN_SLUG_TO_DOC_TYPE in extractor.py is a
        # closed mapping, so this should not be reachable in practice.
        return _result('error', None, ['Document type could not be determined'])

    # Groq itself failing is a PROCESSING FAILURE, not evidence the
    # document is invalid (Step 13: never let a system failure become a
    # rejection or an approval).
    if extraction_status == 'error':
        return _result('error', None, ['Automated field extraction could not be completed'])

    if graph_status == 'error':
        return _result('error', None, ['Automated risk analysis could not be completed'])

    # OCR/extraction genuinely found nothing usable - that is insufficient
    # evidence, not proof the document is bad (Step 13: do not reject
    # solely because OCR is imperfect).
    if extraction_status == 'no_data':
        return _result(
            'pending', None,
            ['Insufficient data was extracted from the document to make a determination']
        )

    # From here: extraction_status is 'success' or 'partial' (Groq ran
    # and produced a real result), and graph_status is 'success' or
    # 'insufficient_data' (graph analysis did not error).
    missing = _missing_required_fields(doc_type, fields)
    if missing:
        return _result('success', 'rejected', ['Required identity field(s) could not be validated'])

    if graph_status == 'success' and _has_strong_graph_signal(graph_analysis):
        return _result(
            'success', 'suspicious',
            ['Strong identity relationship detected across different users']
        )

    return _result('success', 'approved', [
        'Supported KYC document',
        'Required identity fields extracted successfully',
        'Deterministic identity validation passed',
        'No blocking graph anomaly detected'
    ])

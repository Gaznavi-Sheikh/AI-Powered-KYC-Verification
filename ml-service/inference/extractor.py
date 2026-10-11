import os
import re
import json
from datetime import datetime
from groq import Groq

# Chosen empirically (see ml-service/README.md "Groq model choice") for
# minimum token usage on a free-tier account: qwen/qwen3.8-27b answered a
# full PAN extraction in 161 total tokens and 319ms; the gpt-oss models
# available on this account are reasoning models that spent their entire
# token budget on hidden reasoning and returned empty output at the same
# budget, making them both slower and more expensive per real answer.
GROQ_MODEL = os.environ.get('GROQ_MODEL', 'qwen/qwen3.8-27b')
GROQ_TIMEOUT_SECONDS = 15
GROQ_MAX_TOKENS = 500

# Single source of truth for document-type-aware extraction targets
# (Step 4). These are extraction targets, not mandatory values - any
# field absent from the OCR text must come back null.
SCHEMAS = {
    'pan': ['name', 'pan_number', 'date_of_birth', 'father_name'],
    'aadhaar': ['name', 'aadhaar_number', 'date_of_birth', 'gender', 'address'],
    'passport': [
        'surname', 'given_name', 'passport_number', 'nationality',
        'date_of_birth', 'sex', 'date_of_issue', 'date_of_expiry', 'place_of_birth'
    ]
}

# CNN's output slugs (Phase 5) mapped to this module's document_type.
CNN_SLUG_TO_DOC_TYPE = {
    'aadhaar': 'aadhaar',
    'pan': 'pan',
    'passport': 'passport',
    'unknown': 'non_kyc'
}

_DATE_FIELD_NAMES = {'date_of_birth', 'date_of_issue', 'date_of_expiry'}
# Only unambiguous explicit formats - never a fuzzy/guessing date parser.
_DATE_INPUT_FORMATS = ['%d/%m/%Y', '%d-%m-%Y', '%d.%m.%Y', '%Y-%m-%d', '%d %B %Y', '%d %b %Y']
_PAN_RE = re.compile(r'^[A-Z]{5}[0-9]{4}[A-Z]$')

_client = None
_init_error = None


def _get_client():
    """Lazily creates and caches the Groq client. No network call happens
    here - just checks the key is present and constructs the SDK client."""
    global _client, _init_error

    if _client is not None:
        return _client

    api_key = os.environ.get('GROQ_API_KEY')
    if not api_key:
        _init_error = 'GROQ_API_KEY is not set'
        return None

    try:
        _client = Groq(api_key=api_key, timeout=GROQ_TIMEOUT_SECONDS)
        _init_error = None
        return _client
    except Exception as exc:
        _init_error = str(exc)
        return None


def is_configured():
    return _get_client() is not None


def get_init_error():
    return _init_error


def _normalize_date(value):
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    for fmt in _DATE_INPUT_FORMATS:
        try:
            return datetime.strptime(value, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    # Ambiguous or unrecognized format - do not guess, return null.
    return None


def _validate_field(field_name, value):
    """Deterministic, non-LLM validation (Step 9). Returns the cleaned
    value, or None if it doesn't look right - never fabricates a
    corrected value."""
    if value is None or not isinstance(value, str):
        return None
    value = value.strip()
    if not value:
        return None

    if field_name in _DATE_FIELD_NAMES:
        return _normalize_date(value)

    if field_name == 'pan_number':
        candidate = value.upper().replace(' ', '')
        return candidate if _PAN_RE.match(candidate) else None

    if field_name == 'aadhaar_number':
        candidate = re.sub(r'[\s-]', '', value)
        return candidate if re.match(r'^\d{12}$', candidate) else None

    # No deterministic rule is justified for free-text fields (name,
    # address, nationality, etc. - Step 9 only asks for PAN/Aadhaar/date
    # rules). Keep the LLM's value, already constrained by the prompt to
    # "use only the OCR text." Cap length defensively.
    return value[:300]


def _build_system_prompt(doc_type, field_names):
    fields_desc = ', '.join(field_names)
    return (
        f"You extract structured fields from OCR text of a {doc_type.upper()} document. "
        "Follow these rules strictly:\n"
        "1. Use ONLY the supplied OCR text as your source of information.\n"
        "2. Never invent, guess, or infer a value that is not clearly present in the text.\n"
        "3. Never use outside knowledge to correct, complete, or 'fix' a value.\n"
        "4. If a field is not clearly present in the text, its value MUST be null.\n"
        "5. If the OCR text is unclear, garbled, or ambiguous for a field, return null for "
        "that field rather than guessing.\n"
        "6. Do not convert an uncertain value into a confident-looking one.\n"
        f"7. Return ONLY a single JSON object with exactly these keys, nothing else: {fields_desc}.\n"
        "8. Do not add any keys beyond the ones listed above.\n"
        "9. Do not include any explanation, markdown, or text outside the JSON object.\n"
        "10. Every value must be a string or null - never a number, boolean, or nested object."
    )


def extract_fields(cnn_slug, ocr_raw_text):
    """
    Turns OCR text into structured fields for the document type the CNN
    picked. Never raises: every expected failure mode (non-KYC document,
    empty OCR, missing API key, Groq error, malformed JSON) becomes a
    normal return value with an explicit extraction_status, so a Groq
    failure never destroys the CNN/OCR results already obtained upstream.

    Returns: {"document_type": str, "extraction_status": str, "fields": dict}
    """
    doc_type = CNN_SLUG_TO_DOC_TYPE.get(cnn_slug, 'non_kyc')

    if doc_type == 'non_kyc':
        # Step 5: never ask the LLM to invent KYC fields for a document
        # the CNN didn't recognize as KYC. Groq is not called at all.
        return {'document_type': doc_type, 'extraction_status': 'not_applicable', 'fields': {}}

    schema_fields = SCHEMAS[doc_type]

    if not ocr_raw_text or not ocr_raw_text.strip():
        # Step 16: no usable text - skip the API call entirely.
        return {
            'document_type': doc_type,
            'extraction_status': 'no_data',
            'fields': {f: None for f in schema_fields}
        }

    client = _get_client()
    if client is None:
        # Missing/invalid key or client init failure. Never fabricate
        # fields - surface a clean error status instead.
        return {
            'document_type': doc_type,
            'extraction_status': 'error',
            'fields': {f: None for f in schema_fields}
        }

    system_prompt = _build_system_prompt(doc_type, schema_fields)

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': f'OCR TEXT:\n{ocr_raw_text}'}
            ],
            max_tokens=GROQ_MAX_TOKENS,
            temperature=0,
            response_format={'type': 'json_object'}
        )
        raw_content = response.choices[0].message.content
    except Exception as exc:
        # Covers auth failure, rate limit, timeout, connection error, and
        # any other Groq SDK exception. This message is an API/network
        # error string, not document content - safe to log.
        print(f'Groq extraction request failed: {exc}')
        return {
            'document_type': doc_type,
            'extraction_status': 'error',
            'fields': {f: None for f in schema_fields}
        }

    try:
        parsed = json.loads(raw_content)
        if not isinstance(parsed, dict):
            raise ValueError('LLM response is not a JSON object')
    except Exception as exc:
        # Malformed JSON - never fabricate fallback values.
        print(f'Groq returned unparseable JSON: {exc}')
        return {
            'document_type': doc_type,
            'extraction_status': 'error',
            'fields': {f: None for f in schema_fields}
        }

    # Only whitelisted keys for this document type are accepted - any
    # extra key the LLM adds is silently dropped, never stored (Step 8).
    validated_fields = {
        field_name: _validate_field(field_name, parsed.get(field_name))
        for field_name in schema_fields
    }

    non_null_count = sum(1 for v in validated_fields.values() if v is not None)
    if non_null_count == 0:
        status = 'no_data'
    elif non_null_count == len(schema_fields):
        status = 'success'
    else:
        status = 'partial'

    return {'document_type': doc_type, 'extraction_status': status, 'fields': validated_fields}

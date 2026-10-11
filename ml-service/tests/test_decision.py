import os
import sys
import io
import contextlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from inference import decision

# All identity values below are fictional test fixtures only.
FAKE_PAN = 'ABCDE1234F'
FAKE_AADHAAR = '111122223333'
FAKE_PASSPORT = 'P1234567'

OCR_OK = {'has_text': True, 'raw_text': 'some text', 'detections': []}
GRAPH_LOW = {
    'status': 'success', 'anomalyScore': 0.0, 'riskLevel': 'low',
    'signals': [], 'graphFeatures': {'connectedUsers': 0}
}
GRAPH_INSUFFICIENT = {'status': 'insufficient_data', 'anomalyScore': None, 'riskLevel': None, 'signals': [], 'graphFeatures': {}}
GRAPH_ERROR = {'status': 'error', 'anomalyScore': None, 'riskLevel': None, 'signals': [], 'graphFeatures': {}}
GRAPH_STRONG = {
    'status': 'success', 'anomalyScore': 0.5, 'riskLevel': 'high',
    'signals': ['A strong identifier (PAN/Aadhaar/passport number) is shared with 1 other user(s)'],
    'graphFeatures': {'connectedUsers': 1}
}
GRAPH_WEAK = {
    'status': 'success', 'anomalyScore': 0.15, 'riskLevel': 'medium',
    'signals': ['Name is shared with 1 other user(s), with no strong identifier match'],
    'graphFeatures': {'connectedUsers': 1}
}


def _pan_extraction(pan_number=FAKE_PAN, name='JOHN DOE', status='success'):
    return {
        'document_type': 'pan',
        'extraction_status': status,
        'fields': {'name': name, 'pan_number': pan_number, 'date_of_birth': None, 'father_name': None}
    }


def _aadhaar_extraction(aadhaar_number=FAKE_AADHAAR, name='JANE SMITH', status='success'):
    return {
        'document_type': 'aadhaar',
        'extraction_status': status,
        'fields': {'name': name, 'aadhaar_number': aadhaar_number, 'date_of_birth': None, 'gender': None, 'address': None}
    }


def _passport_extraction(passport_number=FAKE_PASSPORT, surname='KUMAR', given_name='RAVI', status='success'):
    return {
        'document_type': 'passport',
        'extraction_status': status,
        'fields': {
            'surname': surname, 'given_name': given_name, 'passport_number': passport_number,
            'nationality': None, 'date_of_birth': None, 'sex': None,
            'date_of_issue': None, 'date_of_expiry': None, 'place_of_birth': None
        }
    }


# ===== Basic decisions =====

def test_1_valid_pan_approved():
    result = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_LOW)
    assert result['decision'] == 'approved'
    assert result['status'] == 'success'


def test_2_valid_aadhaar_approved():
    result = decision.decide('aadhaar', 0.99, OCR_OK, _aadhaar_extraction(), GRAPH_LOW)
    assert result['decision'] == 'approved'


def test_3_valid_passport_approved():
    result = decision.decide('passport', 0.99, OCR_OK, _passport_extraction(), GRAPH_LOW)
    assert result['decision'] == 'approved'


def test_4_non_kyc_rejected():
    non_kyc_extraction = {'document_type': 'non_kyc', 'extraction_status': 'not_applicable', 'fields': {}}
    non_kyc_graph = {'status': 'not_applicable', 'anomalyScore': None, 'riskLevel': None, 'signals': [], 'graphFeatures': {}}
    result = decision.decide('unknown', 0.99, OCR_OK, non_kyc_extraction, non_kyc_graph)
    assert result['decision'] == 'rejected'
    assert result['status'] == 'success'


def test_5_missing_required_field_not_approved():
    extraction = _pan_extraction(pan_number=None, status='partial')
    result = decision.decide('pan', 0.99, OCR_OK, extraction, GRAPH_LOW)
    assert result['decision'] != 'approved'


def test_6_invalid_pan_rejected():
    # extractor.py already nulls invalid PAN format before this stage -
    # simulating that by passing pan_number=None with status='partial'
    # (the same observable state an invalid PAN produces).
    extraction = _pan_extraction(pan_number=None, status='partial')
    result = decision.decide('pan', 0.99, OCR_OK, extraction, GRAPH_LOW)
    assert result['decision'] == 'rejected'


# ===== Graph decisions =====

def test_7_low_graph_risk_approved():
    result = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_LOW)
    assert result['decision'] == 'approved'


def test_8_strong_cross_user_match_suspicious():
    result = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_STRONG)
    assert result['decision'] == 'suspicious'


def test_9_weak_name_only_match_not_auto_rejected():
    result = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_WEAK)
    assert result['decision'] != 'rejected'
    # Explicitly: a weak-only match does not force suspicious either.
    assert result['decision'] == 'approved'


def test_10_high_anomaly_with_strong_signal_suspicious():
    result = decision.decide('aadhaar', 0.99, OCR_OK, _aadhaar_extraction(), GRAPH_STRONG)
    assert result['decision'] == 'suspicious'
    assert result['status'] == 'success'


# ===== Failure handling =====

def test_11_groq_failure_no_approval():
    extraction = {'document_type': 'pan', 'extraction_status': 'error', 'fields': {}}
    result = decision.decide('pan', 0.99, OCR_OK, extraction, GRAPH_LOW)
    assert result['decision'] != 'approved'
    assert result['decision'] is None
    assert result['status'] == 'error'


def test_12_graph_failure_no_false_approval():
    result = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_ERROR)
    assert result['decision'] is None
    assert result['status'] == 'error'


def test_13_cnn_failure_no_false_approval():
    result = decision.decide(None, None, OCR_OK, _pan_extraction(), GRAPH_LOW)
    assert result['decision'] is None
    assert result['status'] == 'error'


def test_14_ocr_insufficient_evidence_no_false_approval():
    extraction = {'document_type': 'pan', 'extraction_status': 'no_data', 'fields': {'name': None, 'pan_number': None, 'date_of_birth': None, 'father_name': None}}
    result = decision.decide('pan', 0.99, {'has_text': False, 'raw_text': '', 'detections': []}, extraction, GRAPH_INSUFFICIENT)
    assert result['decision'] is None
    assert result['status'] == 'pending'


def test_15_ml_unavailable_no_false_approval():
    # Mirrors what controllers/kyc.js passes when Flask is unreachable:
    # extraction and graph_analysis are both None.
    result = decision.decide(None, None, None, None, None)
    assert result['decision'] is None
    assert result['status'] == 'error'


# ===== Explainability =====

def test_16_approved_has_reasons():
    result = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_LOW)
    assert len(result['reasons']) > 0


def test_17_suspicious_has_reasons():
    result = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_STRONG)
    assert len(result['reasons']) > 0


def test_18_rejected_has_reasons():
    non_kyc_extraction = {'document_type': 'non_kyc', 'extraction_status': 'not_applicable', 'fields': {}}
    non_kyc_graph = {'status': 'not_applicable', 'anomalyScore': None, 'riskLevel': None, 'signals': [], 'graphFeatures': {}}
    result = decision.decide('unknown', 0.99, OCR_OK, non_kyc_extraction, non_kyc_graph)
    assert len(result['reasons']) > 0


def test_19_reasons_contain_no_raw_identity_values():
    result = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_STRONG)
    reasons_text = ' '.join(result['reasons'])
    assert FAKE_PAN not in reasons_text
    assert 'JOHN DOE' not in reasons_text


# ===== Security =====

def test_20_no_sensitive_values_logged():
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_STRONG)
    output = captured.getvalue()
    assert FAKE_PAN not in output
    assert 'JOHN DOE' not in output


def test_21_no_api_key_logged():
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_LOW)
    assert 'gsk_' not in captured.getvalue()


# ===== Rule consistency / determinism =====

def test_rule_version_present_and_consistent():
    r1 = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_LOW)
    r2 = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_LOW)
    assert r1['ruleVersion'] == r2['ruleVersion'] == decision.RULE_VERSION


def test_same_inputs_produce_same_output():
    r1 = decision.decide('aadhaar', 0.87, OCR_OK, _aadhaar_extraction(), GRAPH_WEAK)
    r2 = decision.decide('aadhaar', 0.87, OCR_OK, _aadhaar_extraction(), GRAPH_WEAK)
    assert r1 == r2


def test_approved_requires_graph_not_error_or_missing():
    # Approval must never occur when graph status is error - even with
    # perfectly valid extraction.
    result = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_ERROR)
    assert result['decision'] != 'approved'


def test_insufficient_graph_data_can_still_approve():
    # insufficient_data is a valid finding (nothing to compare against),
    # not a failure - must not block approval on its own.
    result = decision.decide('pan', 0.99, OCR_OK, _pan_extraction(), GRAPH_INSUFFICIENT)
    assert result['decision'] == 'approved'

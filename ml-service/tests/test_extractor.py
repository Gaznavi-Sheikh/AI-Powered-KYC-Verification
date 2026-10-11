import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Importing app (not just inference.extractor directly) triggers app.py's
# load_dotenv() as a side effect, same as every other test file in this
# suite - otherwise GROQ_API_KEY is never loaded from .env for these tests.
from app import app  # noqa: F401
from inference import extractor


def test_groq_is_configured():
    # Test 1: Groq configuration - valid API key/configuration is detected
    assert extractor.is_configured() is True
    assert extractor.get_init_error() is None


def test_pan_extraction_real_api_call():
    # Test 2: controlled PAN OCR text -> real Groq call -> correct fields
    ocr_text = "INCOME TAX DEPARTMENT\nGOVT OF INDIA\nJOHN DOE\nABCDE1234F"
    result = extractor.extract_fields('pan', ocr_text)

    assert result['document_type'] == 'pan'
    assert result['extraction_status'] in ('success', 'partial')
    assert result['fields']['name'] == 'JOHN DOE'
    assert result['fields']['pan_number'] == 'ABCDE1234F'


def test_missing_field_returns_null_not_guessed():
    # Test 3: OCR text has no DOB -> date_of_birth must be null, not guessed
    ocr_text = "INCOME TAX DEPARTMENT\nGOVT OF INDIA\nJOHN DOE\nABCDE1234F"
    result = extractor.extract_fields('pan', ocr_text)

    assert result['fields']['date_of_birth'] is None
    assert result['fields']['father_name'] is None


def test_aadhaar_extraction_real_api_call():
    # Test 4: controlled Aadhaar-style OCR text
    ocr_text = "GOVERNMENT OF INDIA\nJANE SMITH\nDOB: 15/08/1990\nFEMALE\n1234 5678 9012"
    result = extractor.extract_fields('aadhaar', ocr_text)

    assert result['document_type'] == 'aadhaar'
    assert result['fields']['name'] == 'JANE SMITH'
    # 12-digit Aadhaar number, possibly OCR'd with spaces - the
    # deterministic validator should strip spaces and accept it.
    assert result['fields']['aadhaar_number'] == '123456789012'
    assert result['fields']['date_of_birth'] == '1990-08-15'


def test_passport_extraction_real_api_call():
    # Test 5: controlled passport-style OCR text
    ocr_text = (
        "REPUBLIC OF INDIA\nPASSPORT\nSurname: KUMAR\nGiven Name: RAVI\n"
        "Passport No: Z1234567\nNationality: INDIAN\nSex: M"
    )
    result = extractor.extract_fields('passport', ocr_text)

    assert result['document_type'] == 'passport'
    assert result['fields']['surname'] == 'KUMAR'
    assert result['fields']['given_name'] == 'RAVI'
    assert result['fields']['nationality'] == 'INDIAN'
    # Fields absent from this controlled text must stay null.
    assert result['fields']['date_of_issue'] is None
    assert result['fields']['place_of_birth'] is None


def test_non_kyc_skips_groq_entirely(monkeypatch):
    # Test 6: CNN says non-KYC -> Groq must not be called at all
    called = {'value': False}

    def fail_if_called(*args, **kwargs):
        called['value'] = True
        raise AssertionError('Groq should not have been called for a non-KYC document')

    monkeypatch.setattr(extractor, '_get_client', fail_if_called)

    result = extractor.extract_fields('unknown', 'some text that should be ignored')

    assert called['value'] is False
    assert result == {'document_type': 'non_kyc', 'extraction_status': 'not_applicable', 'fields': {}}


def test_empty_ocr_skips_groq_entirely(monkeypatch):
    # Test 7: empty OCR text -> Groq must not be called, no_data returned
    called = {'value': False}

    def fail_if_called(*args, **kwargs):
        called['value'] = True
        raise AssertionError('Groq should not have been called for empty OCR text')

    monkeypatch.setattr(extractor, '_get_client', fail_if_called)

    result = extractor.extract_fields('pan', '')

    assert called['value'] is False
    assert result['extraction_status'] == 'no_data'
    assert all(v is None for v in result['fields'].values())


def test_malformed_llm_json_handled_cleanly(monkeypatch):
    # Test 8: Groq returns non-JSON content -> clean error, no fabricated values
    class FakeMessage:
        content = 'this is not JSON at all {{{'

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    class FakeClient:
        class chat:
            class completions:
                @staticmethod
                def create(**kwargs):
                    return FakeResponse()

    monkeypatch.setattr(extractor, '_get_client', lambda: FakeClient())

    result = extractor.extract_fields('pan', 'INCOME TAX DEPARTMENT\nJOHN DOE\nABCDE1234F')

    assert result['extraction_status'] == 'error'
    assert all(v is None for v in result['fields'].values())


def test_invalid_pan_format_rejected_by_deterministic_validation():
    # Test 10: an LLM-supplied value that doesn't match the PAN format
    # must not be accepted as valid, even though it parsed as JSON fine.
    assert extractor._validate_field('pan_number', 'not-a-real-pan') is None
    assert extractor._validate_field('pan_number', '12345ABCDE') is None
    assert extractor._validate_field('pan_number', 'ABCDE1234F') == 'ABCDE1234F'


def test_ambiguous_date_returns_null_not_guessed():
    assert extractor._normalize_date('sometime in the 90s') is None
    assert extractor._normalize_date('15/08/1990') == '1990-08-15'


def test_groq_unavailable_handled_cleanly(monkeypatch):
    # Test 11: Groq call raises (network/API error) -> clean error status, no crash
    class FailingClient:
        class chat:
            class completions:
                @staticmethod
                def create(**kwargs):
                    raise ConnectionError('simulated network failure')

    monkeypatch.setattr(extractor, '_get_client', lambda: FailingClient())

    result = extractor.extract_fields('pan', 'INCOME TAX DEPARTMENT\nJOHN DOE\nABCDE1234F')

    assert result['extraction_status'] == 'error'
    assert all(v is None for v in result['fields'].values())


def test_missing_api_key_handled_cleanly(monkeypatch):
    # Test 12: no GROQ_API_KEY -> clean configuration error, no secret leakage
    monkeypatch.setattr(extractor, '_client', None)
    monkeypatch.setattr(extractor, '_init_error', None)
    monkeypatch.delenv('GROQ_API_KEY', raising=False)

    assert extractor.is_configured() is False
    assert extractor.get_init_error() == 'GROQ_API_KEY is not set'

    result = extractor.extract_fields('pan', 'INCOME TAX DEPARTMENT\nJOHN DOE\nABCDE1234F')
    assert result['extraction_status'] == 'error'

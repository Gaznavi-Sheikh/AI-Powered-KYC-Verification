import os
import sys
import io
import contextlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from inference import graph

# All values below are fictional test fixtures only - never real KYC data.
FAKE_PAN = 'ABCDE1234F'
FAKE_PAN_2 = 'ZZZZZ9999Z'
FAKE_AADHAAR = '111122223333'
FAKE_PASSPORT = 'P1234567'


def test_single_verification_no_prior_data_is_insufficient():
    # Test 1: first-ever verification, nothing to compare against.
    result = graph.analyze('user-A', 'pan', {'pan_number': FAKE_PAN, 'name': 'JOHN DOE'}, [])
    assert result['status'] == 'insufficient_data'
    assert result['anomalyScore'] is None
    assert result['riskLevel'] is None


def test_multiple_unrelated_users_no_shared_identifiers():
    # Test 2: prior records exist, but none share anything - genuinely low risk.
    existing = [
        {
            'verificationId': 'v1', 'userId': 'user-B',
            'hashes': graph.hash_fields({'pan_number': FAKE_PAN_2, 'name': 'JANE SMITH'})
        }
    ]
    result = graph.analyze('user-A', 'pan', {'pan_number': FAKE_PAN, 'name': 'JOHN DOE'}, existing)
    assert result['status'] == 'success'
    assert result['anomalyScore'] == 0.0
    assert result['riskLevel'] == 'low'
    assert result['graphFeatures']['connectedUsers'] == 0


def test_shared_pan_creates_relationship():
    # Test 3: same PAN, different user -> strong signal detected.
    existing = [
        {
            'verificationId': 'v1', 'userId': 'user-B',
            'hashes': graph.hash_fields({'pan_number': FAKE_PAN})
        }
    ]
    result = graph.analyze('user-A', 'pan', {'pan_number': FAKE_PAN}, existing)
    assert result['status'] == 'success'
    assert result['anomalyScore'] > 0
    assert result['graphFeatures']['connectedUsers'] == 1
    assert any('strong identifier' in s.lower() for s in result['signals'])


def test_shared_aadhaar_creates_relationship():
    # Test 4
    existing = [
        {
            'verificationId': 'v1', 'userId': 'user-B',
            'hashes': graph.hash_fields({'aadhaar_number': FAKE_AADHAAR})
        }
    ]
    result = graph.analyze('user-A', 'aadhaar', {'aadhaar_number': FAKE_AADHAAR}, existing)
    assert result['status'] == 'success'
    assert result['graphFeatures']['connectedUsers'] == 1
    assert result['riskLevel'] in ('medium', 'high')


def test_shared_passport_creates_relationship():
    # Test 5
    existing = [
        {
            'verificationId': 'v1', 'userId': 'user-B',
            'hashes': graph.hash_fields({'passport_number': FAKE_PASSPORT})
        }
    ]
    result = graph.analyze('user-A', 'passport', {'passport_number': FAKE_PASSPORT}, existing)
    assert result['status'] == 'success'
    assert result['graphFeatures']['connectedUsers'] == 1


def test_different_identifiers_no_false_relationship():
    # Test 6: similar-looking but different PAN must not match.
    existing = [
        {
            'verificationId': 'v1', 'userId': 'user-B',
            'hashes': graph.hash_fields({'pan_number': FAKE_PAN_2})
        }
    ]
    result = graph.analyze('user-A', 'pan', {'pan_number': FAKE_PAN}, existing)
    assert result['status'] == 'success'
    assert result['anomalyScore'] == 0.0
    assert result['graphFeatures']['connectedUsers'] == 0


def test_normalization_matches_case_and_whitespace_variants():
    # Test 7: "abcde1234f", "ABCDE1234F", and " ABCDE 1234F " must all hash identically.
    h1 = graph._hash_identity_value(FAKE_PAN)
    h2 = graph._hash_identity_value(FAKE_PAN.lower())
    h3 = graph._hash_identity_value(f' {FAKE_PAN[:5]} {FAKE_PAN[5:]} ')
    assert h1 == h2 == h3


def test_empty_extracted_data_handled_safely():
    # Test 8
    result = graph.analyze('user-A', 'pan', {}, [{'verificationId': 'v1', 'userId': 'user-B', 'hashes': {}}])
    assert result['status'] == 'insufficient_data'


def test_missing_fields_handled_safely():
    # Test 9: current_fields has only some keys, several None.
    current = {'pan_number': FAKE_PAN, 'name': None, 'date_of_birth': None, 'father_name': None}
    result = graph.analyze('user-A', 'pan', current, [])
    assert result['status'] == 'insufficient_data'  # no prior data, but this also proves no crash


def test_duplicate_identity_across_two_other_users():
    # Test 10: same PAN shared by TWO distinct other users -> connectedUsers == 2.
    pan_hash = graph.hash_fields({'pan_number': FAKE_PAN})
    existing = [
        {'verificationId': 'v1', 'userId': 'user-B', 'hashes': pan_hash},
        {'verificationId': 'v2', 'userId': 'user-C', 'hashes': pan_hash}
    ]
    result = graph.analyze('user-A', 'pan', {'pan_number': FAKE_PAN}, existing)
    assert result['graphFeatures']['connectedUsers'] == 2
    assert result['graphFeatures']['connectedVerifications'] == 2


def test_same_user_reupload_not_flagged_as_cross_user():
    # Same PAN, but the "other" record belongs to the SAME user - should
    # not count as a cross-user anomaly signal.
    existing = [
        {'verificationId': 'v1', 'userId': 'user-A', 'hashes': graph.hash_fields({'pan_number': FAKE_PAN})}
    ]
    result = graph.analyze('user-A', 'pan', {'pan_number': FAKE_PAN}, existing)
    assert result['status'] == 'success'
    assert result['anomalyScore'] == 0.0
    assert result['graphFeatures']['connectedUsers'] == 0


def test_anomaly_score_within_range():
    # Test 11: even with many sharing users, score never exceeds 1.0.
    pan_hash = graph.hash_fields({'pan_number': FAKE_PAN})
    existing = [
        {'verificationId': f'v{i}', 'userId': f'user-{i}', 'hashes': pan_hash}
        for i in range(10)
    ]
    result = graph.analyze('user-A', 'pan', {'pan_number': FAKE_PAN}, existing)
    assert 0.0 <= result['anomalyScore'] <= 1.0


def test_risk_level_mapping_boundaries():
    # Test 12: zero -> low, one strong match -> >=0.5 -> high (per documented weights).
    none_result = graph.analyze(
        'user-A', 'pan', {'pan_number': FAKE_PAN},
        [{'verificationId': 'v1', 'userId': 'user-B', 'hashes': graph.hash_fields({'pan_number': FAKE_PAN_2})}]
    )
    assert none_result['riskLevel'] == 'low'

    strong_result = graph.analyze(
        'user-A', 'pan', {'pan_number': FAKE_PAN},
        [{'verificationId': 'v1', 'userId': 'user-B', 'hashes': graph.hash_fields({'pan_number': FAKE_PAN})}]
    )
    assert strong_result['riskLevel'] in ('medium', 'high')
    assert strong_result['anomalyScore'] >= graph.STRONG_MATCH_WEIGHT


def test_no_raw_identity_values_in_output_or_logs():
    # Test 13: run analysis with a real-looking fictional PAN and confirm
    # the raw value never appears anywhere in stdout/stderr or the result.
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        existing = [
            {'verificationId': 'v1', 'userId': 'user-B', 'hashes': graph.hash_fields({'pan_number': FAKE_PAN})}
        ]
        result = graph.analyze('user-A', 'pan', {'pan_number': FAKE_PAN}, existing)

    output = captured.getvalue()
    assert FAKE_PAN not in output
    assert FAKE_PAN not in str(result)


def test_insufficient_data_vs_low_risk_distinction():
    # Test 14: no prior records at all -> insufficient_data, NOT "low" risk.
    result = graph.analyze('user-A', 'pan', {'pan_number': FAKE_PAN}, [])
    assert result['status'] == 'insufficient_data'
    assert result['riskLevel'] is None  # explicitly not "low" - no comparison was possible


def test_graph_failure_does_not_crash(monkeypatch):
    # Test 15: force an internal exception during graph construction and
    # confirm it degrades to status="error" instead of raising.
    def broken_hash_fields(fields):
        raise RuntimeError('simulated internal graph failure')

    monkeypatch.setattr(graph, 'hash_fields', broken_hash_fields)

    result = graph.analyze('user-A', 'pan', {'pan_number': FAKE_PAN}, [{'verificationId': 'v1', 'userId': 'user-B', 'hashes': {}}])
    assert result['status'] == 'error'
    assert result['anomalyScore'] is None


def test_non_kyc_is_not_applicable():
    result = graph.analyze('user-A', 'non_kyc', {}, [])
    assert result['status'] == 'not_applicable'

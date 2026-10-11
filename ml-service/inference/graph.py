import re
import hashlib
import networkx as nx

# Identifier fields the graph treats as strong vs weak signals. A shared
# government ID number is a much stronger anomaly signal than a shared
# name (names collide innocently far more often - e.g. common names).
STRONG_FIELDS = {'pan_number', 'aadhaar_number', 'passport_number'}
WEAK_FIELDS = {'name'}

# Deterministic, explainable scoring weights - NOT learned from data.
# See README "GNN / Anomaly Method" for why no trainable model is used.
STRONG_MATCH_WEIGHT = 0.5
WEAK_MATCH_WEIGHT = 0.15
MAX_ANOMALY_SCORE = 1.0
HIGH_RISK_THRESHOLD = 0.5  # anomalyScore >= this -> "high"


def _normalize_identity_value(value):
    """Must match backend/services/identityHash.js's
    normalizeIdentityValue() byte-for-byte: trim, uppercase, strip ALL
    internal whitespace. Any divergence between the two implementations
    silently breaks cross-match detection for identical real-world values."""
    if not isinstance(value, str):
        return None
    normalized = re.sub(r'\s+', '', value.strip().upper())
    return normalized if normalized else None


def _hash_identity_value(value):
    normalized = _normalize_identity_value(value)
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()


def hash_fields(fields):
    """Same field set as identityHash.js's hashIdentityFields(). Used here
    only for the CURRENT document's freshly-extracted fields - hashes for
    every OTHER record are computed Node-side and arrive already hashed,
    so this service never sees another user's raw identity values."""
    if not fields:
        return {}

    hashes = {}
    for key in ('pan_number', 'aadhaar_number', 'passport_number'):
        value = fields.get(key)
        h = _hash_identity_value(value) if value else None
        if h:
            hashes[key] = h

    name = fields.get('name') or ' '.join(
        filter(None, [fields.get('surname'), fields.get('given_name')])
    )
    name_hash = _hash_identity_value(name) if name else None
    if name_hash:
        hashes['name'] = name_hash

    return hashes


def _empty_result(status):
    return {
        'status': status,
        'anomalyScore': None,
        'riskLevel': None,
        'signals': [],
        'graphFeatures': {}
    }


def analyze(current_user_id, document_type, current_fields, existing_identities):
    """
    Graph-based anomaly/risk signal for ONE uploaded document, comparing
    its extracted identifiers against prior Verification records.

    current_fields: extractor.py's extraction['fields'] for this request.
    existing_identities: list of {"verificationId", "userId", "hashes": {...}}
      for OTHER already-stored records - computed Node-side
      (backend/services/identityHash.js) BEFORE this call, so raw values
      for any record other than the current one never reach this service.

    Never raises for expected conditions (non-KYC document, nothing
    extracted, no prior data) - those become explicit status values
    ("not_applicable" / "insufficient_data"), never a fabricated score.
    Only a genuinely unexpected internal error becomes status="error".

    This is a deterministic graph-statistics heuristic, NOT a trained or
    statistically validated fraud classifier - see README.
    """
    if document_type == 'non_kyc':
        return _empty_result('not_applicable')

    try:
        current_hashes = hash_fields(current_fields)

        if not current_hashes:
            # Nothing was extracted for this document - there is nothing
            # to search for. This is NOT the same as "searched and found
            # no risk" - see README "insufficient_data vs low risk".
            return _empty_result('insufficient_data')

        if not existing_identities:
            # No prior records exist anywhere to compare against.
            return _empty_result('insufficient_data')

        graph = nx.Graph()
        current_node = 'current'
        graph.add_node(current_node, kind='verification')

        connected_other_users = set()
        connected_other_verifications = set()
        strong_match_users = set()
        weak_match_users = set()

        for field_name, field_hash in current_hashes.items():
            identifier_node = f'{field_name}:{field_hash}'
            graph.add_node(identifier_node, kind='identifier', field=field_name)
            graph.add_edge(current_node, identifier_node)

            for record in existing_identities:
                record_hashes = record.get('hashes') or {}
                if record_hashes.get(field_name) != field_hash:
                    continue

                other_user_id = record.get('userId')
                other_verification_id = record.get('verificationId')

                record_node = f'verification:{other_verification_id}'
                graph.add_node(record_node, kind='verification')
                graph.add_edge(record_node, identifier_node)

                if other_user_id and other_user_id != current_user_id:
                    connected_other_users.add(other_user_id)
                    connected_other_verifications.add(other_verification_id)
                    if field_name in STRONG_FIELDS:
                        strong_match_users.add(other_user_id)
                    else:
                        weak_match_users.add(other_user_id)

        strong_count = len(strong_match_users)
        # Don't double-count a user already flagged on a strong field.
        weak_count = len(weak_match_users - strong_match_users)

        signals = []
        if strong_count:
            signals.append(
                f'A strong identifier (PAN/Aadhaar/passport number) is shared with '
                f'{strong_count} other user(s)'
            )
        if weak_count:
            signals.append(
                f'Name is shared with {weak_count} other user(s), with no strong '
                f'identifier match'
            )

        anomaly_score = round(
            min(MAX_ANOMALY_SCORE, strong_count * STRONG_MATCH_WEIGHT + weak_count * WEAK_MATCH_WEIGHT),
            4
        )

        if anomaly_score >= HIGH_RISK_THRESHOLD:
            risk_level = 'high'
        elif anomaly_score > 0:
            risk_level = 'medium'
        else:
            risk_level = 'low'

        return {
            'status': 'success',
            'anomalyScore': anomaly_score,
            'riskLevel': risk_level,
            'signals': signals,
            'graphFeatures': {
                'connectedUsers': len(connected_other_users),
                'connectedVerifications': len(connected_other_verifications),
                'nodeDegree': graph.degree(current_node),
                'connectedComponentSize': len(nx.node_connected_component(graph, current_node))
            }
        }
    except Exception as exc:
        # exc here is a graph-library/internal error, never document
        # content - safe to log. Never fabricate a score on failure.
        print(f'Graph analysis failed: {exc}')
        return _empty_result('error')

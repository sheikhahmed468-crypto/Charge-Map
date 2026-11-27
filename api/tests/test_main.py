import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api import main

client = TestClient(main.app)


def _mock_assessment(location, factors):
    return {
        "score": 72,
        "summary": f"{location} looks promising, subject to local verification.",
        "factors": [
            {
                "factor": factor["factor"],
                "impact": "positive",
                "explanation": "Based on the supplied factor value.",
            }
            for factor in factors
        ],
    }


def test_assessment_returns_score_and_each_evidence_source_without_cloud_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(main, "request_local_assessment", _mock_assessment)
    response = client.post(
        "/api/site-assessment",
        json={
            "location": "Blue Area, Islamabad",
            "latitude": 33.7167,
            "longitude": 73.0678,
            "traffic": "high",
            "population": "moderate",
            "ev_adoption": "unknown",
            "parking": "yes",
            "grid_access": "unknown",
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["score"] == 72
    assert len(result["factors"]) == 6
    assert [factor["factor"] for factor in result["factors"]] == [
        "Nearby charging stations",
        "Traffic",
        "Population density",
        "EV adoption",
        "Parking availability",
        "Grid access",
    ]
    adoption = next(factor for factor in result["factors"] if factor["factor"] == "EV adoption")
    assert adoption["value"] == "Data unavailable"
    assert adoption["source"] == "No data provided"
    assert adoption["impact"] == "unknown"
    assert "cannot be assessed" in adoption["explanation"]
    charger_factor = next(factor for factor in result["factors"] if factor["factor"] == "Nearby charging stations")
    assert "known station(s) within 10 km" in charger_factor["value"]
    assert "Bundled Charge Map charger dataset" in charger_factor["source"]
    assert "not a calibrated probability" in result["limitations"]


def test_assessment_does_not_require_cloud_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(main, "request_local_assessment", _mock_assessment)
    response = client.post("/api/site-assessment", json={"location": "Lahore"})

    assert response.status_code == 200


def test_missing_local_model_runtime_returns_clear_error(monkeypatch):
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://127.0.0.1:1")

    with pytest.raises(HTTPException) as error:
        main.request_local_assessment("Lahore", [])

    assert error.value.status_code == 503
    assert "Ollama" in error.value.detail


def test_local_assessment_disables_reasoning_for_concise_output(monkeypatch):
    model_result = {"score": 50, "summary": "Review the local evidence.", "factors": []}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def read(self):
            return json.dumps({"message": {"content": json.dumps(model_result)}}).encode()

    def fake_urlopen(request, timeout):
        body = json.loads(request.data)
        assert body["think"] is False
        assert body["options"]["num_predict"] == 768
        assert body["options"]["num_ctx"] == 2048
        assert body["format"]["properties"]["factors"]["minItems"] == 0
        assert body["format"]["properties"]["factors"]["maxItems"] == 0
        return FakeResponse()

    monkeypatch.setattr(main, "urlopen", fake_urlopen)

    assert main.request_local_assessment("Lahore", []) == model_result


def test_incomplete_model_factor_list_gets_one_schema_guided_retry(monkeypatch):
    factors = [
        {"factor": "Nearby charging stations", "value": "2 nearby", "source": "Bundled dataset"},
        {"factor": "Traffic", "value": "High", "source": "User-provided estimate"},
        {"factor": "EV adoption", "value": "Data unavailable", "source": "No data provided"},
    ]
    expected_names = [factor["factor"] for factor in factors]
    responses = [
        {"score": 60, "summary": "Initial summary.", "factors": [
            {"factor": expected_names[0], "impact": "neutral", "explanation": "Coverage is mixed."},
            {"factor": expected_names[1], "impact": "positive", "explanation": "May indicate demand."},
        ]},
        {"score": 60, "summary": "Initial summary.", "factors": [
            {"factor": name, "impact": "unknown", "explanation": "Based on available evidence."}
            for name in expected_names
        ]},
    ]
    request_bodies = []

    class FakeResponse:
        def __init__(self, result):
            self.result = result

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def read(self):
            return json.dumps({"message": {"content": json.dumps(self.result)}}).encode()

    def fake_urlopen(request, timeout):
        body = json.loads(request.data)
        request_bodies.append(body)
        return FakeResponse(responses[len(request_bodies) - 1])

    monkeypatch.setattr(main, "urlopen", fake_urlopen)

    result = main.request_local_assessment("Lahore", factors)

    factor_schema = request_bodies[0]["format"]["properties"]["factors"]
    assert factor_schema["minItems"] == 3
    assert factor_schema["maxItems"] == 3
    assert factor_schema["items"]["properties"]["factor"]["enum"] == expected_names
    assert "Do not omit or repeat any factor" in request_bodies[1]["messages"][-1]["content"]
    assert len(result["factors"]) == 3


def test_incomplete_model_factor_list_fails_explicitly_after_retry(monkeypatch):
    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def read(self):
            return b'{"message":{"content":"{\\"score\\":50,\\"summary\\":\\"Incomplete\\",\\"factors\\":[]}"}}'

    monkeypatch.setattr(main, "urlopen", lambda *_args, **_kwargs: FakeResponse())

    with pytest.raises(HTTPException) as error:
        main.request_local_assessment(
            "Lahore",
            [{"factor": "Traffic", "value": "High", "source": "User estimate"}],
        )

    assert error.value.status_code == 502
    assert "every required factor" in error.value.detail


def test_coordinates_must_be_provided_as_a_pair():
    response = client.post(
        "/api/site-assessment",
        json={"location": "Lahore", "latitude": 31.52},
    )

    assert response.status_code == 422

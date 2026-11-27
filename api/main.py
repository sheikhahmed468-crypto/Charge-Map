import json
import logging
import math
import os
from pathlib import Path
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError, model_validator

logger = logging.getLogger(__name__)
DATA_FILE = Path(__file__).resolve().parents[1] / "public" / "chargers.json"
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
UNKNOWN = "unknown"
DEFAULT_OLLAMA_MODEL = "qwen3:1.7b"

app = FastAPI(title="Charge Map Site Suitability API", version="1.0.0")


class SiteAssessmentRequest(BaseModel):
    location: str = Field(min_length=2, max_length=160)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    traffic: Literal["unknown", "low", "moderate", "high"] = UNKNOWN
    population: Literal["unknown", "low", "moderate", "high"] = UNKNOWN
    ev_adoption: Literal["unknown", "low", "moderate", "high"] = UNKNOWN
    parking: Literal["unknown", "yes", "no"] = UNKNOWN
    grid_access: Literal["unknown", "limited", "adequate"] = UNKNOWN

    @model_validator(mode="after")
    def coordinates_must_be_paired(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Provide both latitude and longitude, or neither.")
        return self


class FactorAssessment(BaseModel):
    factor: str
    value: str
    source: str
    impact: Literal["positive", "neutral", "negative", "unknown"]
    explanation: str


class SiteAssessmentResponse(BaseModel):
    score: int = Field(ge=0, le=100)
    summary: str
    factors: list[FactorAssessment]
    limitations: str


def haversine_km(first_lat: float, first_lon: float, second_lat: float, second_lon: float) -> float:
    latitude_delta = math.radians(second_lat - first_lat)
    longitude_delta = math.radians(second_lon - first_lon)
    value = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(math.radians(first_lat))
        * math.cos(math.radians(second_lat))
        * math.sin(longitude_delta / 2) ** 2
    )
    return 6371 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def make_factor(factor: str, value: str, source: str) -> dict[str, str]:
    return {"factor": factor, "value": value, "source": source}


def build_factors(payload: SiteAssessmentRequest) -> list[dict[str, str]]:
    factors = []
    if payload.latitude is None or payload.longitude is None:
        charger_value = "Unavailable: location coordinates were not provided"
        charger_source = "Not measured"
    else:
        try:
            data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
            chargers = data.get("chargers", [])
        except (OSError, json.JSONDecodeError) as error:
            logger.exception("Could not load the bundled charger dataset.")
            raise HTTPException(status_code=500, detail="Charger location data is temporarily unavailable.") from error

        distances = []
        for charger in chargers:
            latitude = charger.get("lat")
            longitude = charger.get("lng")
            if isinstance(latitude, (int, float)) and isinstance(longitude, (int, float)):
                distances.append(
                    (haversine_km(payload.latitude, payload.longitude, latitude, longitude), charger.get("name", "Charger"))
                )
        distances.sort(key=lambda result: result[0])
        within_10_km = sum(distance <= 10 for distance, _ in distances)
        if distances:
            charger_value = (
                f"{within_10_km} known station(s) within 10 km; "
                f"nearest is {distances[0][1]} at {distances[0][0]:.1f} km"
            )
        else:
            charger_value = "No charger locations available in the dataset"
        charger_source = "Bundled Charge Map charger dataset; 10 km radius"

    factors.append(make_factor("Nearby charging stations", charger_value, charger_source))

    user_factors = [
        ("Traffic", payload.traffic),
        ("Population density", payload.population),
        ("EV adoption", payload.ev_adoption),
        ("Parking availability", payload.parking),
        ("Grid access", payload.grid_access),
    ]
    for label, value in user_factors:
        factors.append(
            make_factor(
                label,
                "Data unavailable" if value == UNKNOWN else value.replace("_", " ").title(),
                "No data provided" if value == UNKNOWN else "User-provided estimate",
            )
        )
    return factors


def request_local_assessment(location: str, factors: list[dict[str, str]]) -> dict:
    model = os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)
    base_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    factor_names = [factor["factor"] for factor in factors]
    factor_name_schema = {"type": "string"}
    if factor_names:
        factor_name_schema["enum"] = factor_names
    response_schema = {
        "type": "object",
        "properties": {
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "summary": {"type": "string", "maxLength": 280},
            "factors": {
                "type": "array",
                "minItems": len(factor_names),
                "maxItems": len(factor_names),
                "items": {
                    "type": "object",
                    "properties": {
                        "factor": factor_name_schema,
                        "impact": {"type": "string", "enum": ["positive", "neutral", "negative", "unknown"]},
                        "explanation": {"type": "string", "maxLength": 160},
                    },
                    "required": ["factor", "impact", "explanation"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["score", "summary", "factors"],
        "additionalProperties": False,
    }
    prompt = {"location": location, "factors": factors}
    request_body = {
        "model": model,
        "stream": False,
        "think": False,
        "format": response_schema,
        "options": {"temperature": 0.1, "num_predict": 768, "num_ctx": 2048},
        "messages": [
            {
                "role": "system",
                "content": (
                    "Assess preliminary EV charging-site suitability with a practical heuristic score, never a "
                    "probability. Use only the supplied evidence; never invent measurements. Unknown data must "
                    "have impact 'unknown' and say it is unavailable. Traffic, population and EV adoption may "
                    "indicate demand, not guaranteed customers. Parking and grid access affect feasibility. "
                    "Existing chargers indicate both coverage and competition; no nearby chargers may mean "
                    "unmet demand or infrastructure barriers. Return one concise factor explanation per supplied "
                    "factor, in input order, with at most 12 words each. Keep the summary under 35 words."
                ),
            },
            {"role": "user", "content": json.dumps(prompt)},
        ],
    }
    try:
        for attempt in range(2):
            request = Request(
                f"{base_url}/api/chat",
                data=json.dumps(request_body).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request, timeout=180) as response:
                data = json.loads(response.read().decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("message"), dict):
                raise ValueError("The local model returned an invalid response.")
            content = data["message"].get("content")
            try:
                result = json.loads(content) if isinstance(content, str) and content else None
            except json.JSONDecodeError:
                result = None

            returned_factors = result.get("factors") if isinstance(result, dict) else None
            returned_names = [
                factor.get("factor") for factor in returned_factors if isinstance(factor, dict)
            ] if isinstance(returned_factors, list) else []
            is_complete = (
                isinstance(returned_factors, list)
                and len(returned_factors) == len(factor_names)
                and len(returned_names) == len(returned_factors)
                and all(isinstance(name, str) for name in returned_names)
                and set(returned_names) == set(factor_names)
            )
            if is_complete:
                return result
            if attempt == 0:
                logger.warning("Local model returned an incomplete factor analysis; retrying once.")
                if isinstance(content, str) and content:
                    request_body["messages"].append({"role": "assistant", "content": content})
                request_body["messages"].append(
                    {
                        "role": "user",
                        "content": (
                            "Return the entire assessment again with exactly one factor for each input name, "
                            f"in this order: {', '.join(factor_names)}. Do not omit or repeat any factor."
                        ),
                    }
                )
        raise HTTPException(
            status_code=502,
            detail="Local AI could not return every required factor. Please try the assessment again.",
        )
    except HTTPError as error:
        logger.error("Ollama returned HTTP %s while assessing a site.", error.code)
        if error.code == 404:
            raise HTTPException(
                status_code=503,
                detail=f"Local model '{model}' is not installed. Run: ollama pull {model}",
            ) from error
        raise HTTPException(status_code=502, detail="The local model could not complete the assessment.") from error
    except URLError as error:
        logger.warning("Could not connect to local Ollama: %s", error.reason)
        raise HTTPException(
            status_code=503,
            detail="Local AI is not running. Start Ollama and make sure the selected model is installed.",
        ) from error
    except (TimeoutError, ValueError) as error:
        logger.exception("The local model returned an invalid or timed-out assessment.")
        raise HTTPException(status_code=502, detail="The local model returned an invalid assessment. Please try again.") from error


@app.post("/api/site-assessment", response_model=SiteAssessmentResponse)
def assess_site(payload: SiteAssessmentRequest) -> SiteAssessmentResponse:
    factors = build_factors(payload)
    result = request_local_assessment(payload.location, factors)
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="The AI provider returned an invalid assessment. Please try again.")

    supplied_factors = {factor["factor"]: factor for factor in factors}
    returned_factors = result.get("factors")
    if not isinstance(returned_factors, list):
        raise HTTPException(status_code=502, detail="Local AI could not return every required factor. Please try again.")
    if len(returned_factors) != len(supplied_factors):
        raise HTTPException(status_code=502, detail="Local AI could not return every required factor. Please try again.")

    validated_factors = {}
    seen_factors = set()
    for item in returned_factors:
        if not isinstance(item, dict) or not isinstance(item.get("factor"), str):
            raise HTTPException(status_code=502, detail="The AI provider returned an invalid factor.")
        if item["factor"] not in supplied_factors:
            raise HTTPException(status_code=502, detail="The AI provider returned an unknown factor.")
        evidence = supplied_factors[item["factor"]]
        if item["factor"] in seen_factors:
            raise HTTPException(status_code=502, detail="The AI provider returned a duplicate factor.")
        seen_factors.add(item["factor"])
        impact = item.get("impact")
        explanation = item.get("explanation", "")
        if evidence["value"].startswith(("Data unavailable", "Unavailable", "No charger locations available")):
            impact = "unknown"
            explanation = "No reliable evidence was provided for this factor, so its impact cannot be assessed."
        validated_factors[item["factor"]] = FactorAssessment(
            factor=evidence["factor"],
            value=evidence["value"],
            source=evidence["source"],
            impact=impact,
            explanation=explanation,
        )
    if seen_factors != set(supplied_factors):
        raise HTTPException(status_code=502, detail="Local AI could not return every required factor. Please try again.")
    result["factors"] = [validated_factors[factor["factor"]] for factor in factors]
    result["limitations"] = (
        "Local open-source AI decision-support score, not a calibrated probability. Traffic, population, EV adoption, "
        "parking and grid access are user-provided or unavailable; verify locally before investment."
    )
    try:
        return SiteAssessmentResponse.model_validate(result)
    except ValidationError as error:
        logger.exception("Could not validate model site assessment.")
        raise HTTPException(status_code=502, detail="The AI provider returned an invalid assessment. Please try again.") from error

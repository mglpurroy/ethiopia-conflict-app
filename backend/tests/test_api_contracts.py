from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from services.conflict_service import load_population_data


def _sample_pcodes() -> dict[str, list[str]]:
    pop = load_population_data()
    adm1 = [v for v in pop.get("ADM1_PCODE", []).astype(str).tolist() if v]
    adm2 = [v for v in pop.get("ADM2_PCODE", []).astype(str).tolist() if v]
    adm3 = [v for v in pop.get("ADM3_PCODE", []).astype(str).tolist() if v]

    # Preserve source ordering and dedupe.
    unique = lambda vals: list(dict.fromkeys(vals))
    return {
        "ADM1": unique(adm1)[:2],
        "ADM2": unique(adm2)[:2],
        "ADM3": unique(adm3)[:2],
    }


def test_meta_periods_contract():
    client = TestClient(app)
    response = client.get("/api/meta/periods")
    assert response.status_code == 200
    body = response.json()
    assert "periods" in body
    assert isinstance(body["periods"], list)
    assert len(body["periods"]) > 0

    sample = body["periods"][0]
    for key in ["id", "label", "start_year", "start_month", "end_year", "end_month", "type"]:
        assert key in sample


def test_spatial_classification_contract():
    client = TestClient(app)
    period_id = client.get("/api/meta/periods").json()["periods"][0]["id"]
    response = client.get(
        "/api/spatial/classification",
        params={
            "period_id": period_id,
            "map_view": "regions_zones",
            "agg_level": "ADM2",
            "analysis_type": "conflict_metrics",
            "map_var": "share_woredas",
            "conflict_metric": "conflict_affected",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body.get("type") == "FeatureCollection"
    assert "features" in body


def test_spatial_events_contract_with_period_and_location_filter():
    client = TestClient(app)
    period_id = client.get("/api/meta/periods").json()["periods"][0]["id"]
    pcodes = _sample_pcodes()
    response = client.get(
        "/api/spatial/events",
        params={"period_id": period_id, "level": 1, "pcode": pcodes["ADM1"][0], "limit": 1000},
    )
    assert response.status_code == 200
    body = response.json()
    assert body.get("type") == "FeatureCollection"
    assert isinstance(body.get("features"), list)


def test_trends_location_contract():
    client = TestClient(app)
    pcodes = _sample_pcodes()
    response = client.get("/api/trends/location", params={"pcode": pcodes["ADM3"][0], "level": "ADM3"})
    assert response.status_code == 200
    body = response.json()
    for key in ["location", "trajectory", "series"]:
        assert key in body
    assert isinstance(body["series"], list)


def test_absolute_series_contract():
    client = TestClient(app)
    pcodes = _sample_pcodes()
    joined = ",".join(pcodes["ADM3"])
    response = client.get(
        "/api/absolute/series",
        params={"pcodes": joined, "level": "ADM3", "granularity": "monthly"},
    )
    assert response.status_code == 200
    body = response.json()
    for key in ["level", "granularity", "period_start", "period_end", "periods", "locations"]:
        assert key in body
    assert isinstance(body["locations"], list)
    if body["locations"]:
        location = body["locations"][0]
        for key in ["pcode", "name", "total_deaths", "total_events", "series"]:
            assert key in location


def test_export_contracts():
    client = TestClient(app)
    period_id = client.get("/api/meta/periods").json()["periods"][0]["id"]
    pcodes = _sample_pcodes()

    agg = client.get(
        "/api/export/aggregated",
        params={"period_id": period_id, "level": "ADM2", "conflict_metric": "conflict_affected"},
    )
    assert agg.status_code == 200
    assert "text/csv" in agg.headers.get("content-type", "")

    abs_summary = client.get(
        "/api/export/absolute-summary",
        params={"pcodes": pcodes["ADM3"][0], "level": "ADM3"},
    )
    assert abs_summary.status_code == 200
    assert "text/csv" in abs_summary.headers.get("content-type", "")

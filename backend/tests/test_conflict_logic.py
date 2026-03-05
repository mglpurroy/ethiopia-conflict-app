from __future__ import annotations

import pandas as pd

from services.conflict_service import (
    calculate_trajectory_classification,
    classify_and_aggregate,
    generate_12_month_periods,
)


def test_generate_12_month_periods_is_deterministic_and_sorted():
    periods_1 = generate_12_month_periods()
    periods_2 = generate_12_month_periods()

    assert periods_1 == periods_2
    assert len(periods_1) > 1
    assert periods_1[0]["type"] == "rolling_latest"
    assert periods_1[0]["sort_index"] >= periods_1[1]["sort_index"]
    assert all("_" in p["id"] for p in periods_1)


def test_classify_and_aggregate_threshold_logic():
    pop = pd.DataFrame(
        [
            {
                "ADM0_PCODE": "ETH",
                "ADM1_PCODE": "ET01",
                "ADM1_EN": "Region A",
                "ADM2_PCODE": "ET0101",
                "ADM2_EN": "Zone A",
                "ADM3_PCODE": "ET010101",
                "ADM3_EN": "Woreda A",
                "pop_count": 100000,
                "pop_count_millions": 0.1,
            },
            {
                "ADM0_PCODE": "ETH",
                "ADM1_PCODE": "ET01",
                "ADM1_EN": "Region A",
                "ADM2_PCODE": "ET0101",
                "ADM2_EN": "Zone A",
                "ADM3_PCODE": "ET010102",
                "ADM3_EN": "Woreda B",
                "pop_count": 100000,
                "pop_count_millions": 0.1,
            },
            {
                "ADM0_PCODE": "ETH",
                "ADM1_PCODE": "ET01",
                "ADM1_EN": "Region A",
                "ADM2_PCODE": "ET0101",
                "ADM2_EN": "Zone A",
                "ADM3_PCODE": "ET010103",
                "ADM3_EN": "Woreda C",
                "pop_count": 100000,
                "pop_count_millions": 0.1,
            },
        ]
    )
    conflict = pd.DataFrame(
        [
            {
                "ADM3_PCODE": "ET010101",
                "ADM3_EN": "Woreda A",
                "ADM2_PCODE": "ET0101",
                "ADM2_EN": "Zone A",
                "ADM1_PCODE": "ET01",
                "ADM1_EN": "Region A",
                "year": 2025,
                "month": 1,
                "ACLED_BRD_total": 10,
                "ACLED_BRD_state": 5,
                "ACLED_BRD_nonstate": 5,
                "event_count": 3,
            },
            {
                "ADM3_PCODE": "ET010102",
                "ADM3_EN": "Woreda B",
                "ADM2_PCODE": "ET0101",
                "ADM2_EN": "Zone A",
                "ADM1_PCODE": "ET01",
                "ADM1_EN": "Region A",
                "year": 2025,
                "month": 1,
                "ACLED_BRD_total": 40,
                "ACLED_BRD_state": 15,
                "ACLED_BRD_nonstate": 25,
                "event_count": 8,
            },
            {
                "ADM3_PCODE": "ET010103",
                "ADM3_EN": "Woreda C",
                "ADM2_PCODE": "ET0101",
                "ADM2_EN": "Zone A",
                "ADM1_PCODE": "ET01",
                "ADM1_EN": "Region A",
                "year": 2025,
                "month": 1,
                "ACLED_BRD_total": 9,
                "ACLED_BRD_state": 4,
                "ACLED_BRD_nonstate": 5,
                "event_count": 1,
            },
        ]
    )

    aggregated, ward_data = classify_and_aggregate(
        pop_data=pop,
        conflict_data=conflict,
        start_year=2025,
        start_month=1,
        end_year=2025,
        end_month=1,
        agg_level="ADM2",
    )

    by_pcode = ward_data.set_index("ADM3_PCODE")
    assert bool(by_pcode.loc["ET010101", "conflict_affected"]) is True
    assert bool(by_pcode.loc["ET010101", "highly_conflict_affected"]) is False
    assert bool(by_pcode.loc["ET010102", "conflict_affected"]) is True
    assert bool(by_pcode.loc["ET010102", "highly_conflict_affected"]) is True
    assert bool(by_pcode.loc["ET010103", "conflict_affected"]) is False

    row = aggregated.iloc[0]
    assert row["total_woredas"] == 3
    assert row["conflict_affected"] == 2
    assert row["highly_conflict_affected"] == 1


def test_trajectory_classifier_outputs_expected_categories():
    insufficient = pd.DataFrame({"classification": [0, 0], "death_rate": [0.0, 0.0], "deaths": [0.0, 0.0]})
    assert calculate_trajectory_classification(insufficient) == "Insufficient Data"

    stable = pd.DataFrame({"classification": [0, 0, 0, 0], "death_rate": [0.0, 0.0, 0.0, 0.0], "deaths": [0, 0, 0, 0]})
    assert calculate_trajectory_classification(stable) == "Stable"

    onset = pd.DataFrame({"classification": [1, 1, 1, 1], "death_rate": [2.0, 4.0, 6.0, 8.0], "deaths": [12, 20, 30, 45]})
    assert calculate_trajectory_classification(onset) == "Onset"

    recovery = pd.DataFrame(
        {"classification": [2, 2, 2, 2], "death_rate": [20.0, 12.0, 7.0, 3.0], "deaths": [120, 75, 40, 20]}
    )
    assert calculate_trajectory_classification(recovery) == "Recovery"

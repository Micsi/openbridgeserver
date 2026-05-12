"""Unit tests for the flat filterset schema helpers (#431).

Covers the pure transformation helpers in :mod:`obs.api.v1.ringbuffer`
without spinning up the full FastAPI stack:

* The legacy-payload shim that flattens ``groups[]`` and a top-level
  ``query`` onto the new ``filter`` field with a :class:`DeprecationWarning`.
* The :class:`FilterCriteria` → :class:`RingBufferQueryV2` translator that
  the multi-set query and single-set query endpoints use to call the
  underlying ringbuffer.
* Color validation on the public model.

The shim block is scheduled for removal in #438.
"""

from __future__ import annotations

import warnings

import pytest

from obs.api.v1.ringbuffer import (
    FilterCriteria,
    NodeRef,
    RingBufferTimeFilterV2,
    RingBufferValueFilterV2,
    _filter_to_query_v2,
    _flatten_legacy_filterset_payload,
    _legacy_groups_to_filter,
)


def test_legacy_groups_to_filter_collects_or_lists_across_groups_and_rules():
    groups = [
        {
            "name": "G1",
            "rules": [
                {
                    "name": "R1",
                    "query": {
                        "filters": {
                            "adapters": {"any_of": ["api", "knx"]},
                            "datapoints": {"ids": ["dp-1"]},
                        }
                    },
                }
            ],
        },
        {
            "name": "G2",
            "rules": [
                {
                    "name": "R2",
                    "query": {
                        "filters": {
                            "datapoints": {"ids": ["dp-2"]},
                            "metadata": {"tags_any_of": ["tag-a", "tag-b"]},
                            "q": "kitchen",
                        }
                    },
                }
            ],
        },
    ]
    result = _legacy_groups_to_filter(groups)
    assert isinstance(result, FilterCriteria)
    assert result.adapters == ["api", "knx"]
    assert result.datapoints == ["dp-1", "dp-2"]
    assert result.tags == ["tag-a", "tag-b"]
    assert result.q == "kitchen"


def test_legacy_groups_to_filter_picks_first_value_filter_only():
    """The flat schema supports a single value_filter — extras are silently dropped."""
    groups = [
        {
            "rules": [
                {
                    "query": {
                        "filters": {
                            "values": [
                                {"operator": "gt", "value": 10},
                                {"operator": "lt", "value": 20},
                            ]
                        }
                    }
                }
            ]
        }
    ]
    result = _legacy_groups_to_filter(groups)
    assert result.value_filter is not None
    assert result.value_filter.operator == "gt"
    assert result.value_filter.value == 10


def test_legacy_groups_to_filter_deduplicates_repeated_values():
    groups = [
        {
            "rules": [
                {"query": {"filters": {"adapters": {"any_of": ["api"]}}}},
                {"query": {"filters": {"adapters": {"any_of": ["api", "knx"]}}}},
            ]
        }
    ]
    result = _legacy_groups_to_filter(groups)
    assert result.adapters == ["api", "knx"]


def test_flatten_legacy_payload_emits_deprecation_warning_for_groups():
    raw = {
        "name": "legacy",
        "groups": [{"rules": [{"query": {"filters": {"datapoints": {"ids": ["dp-1"]}}}}]}],
    }
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = _flatten_legacy_filterset_payload(raw)
    assert "groups" not in result
    assert result["filter"]["datapoints"] == ["dp-1"]
    assert any(issubclass(c.category, DeprecationWarning) for c in caught)


def test_flatten_legacy_payload_emits_deprecation_warning_for_top_level_query():
    raw = {
        "name": "legacy",
        "query": {"filters": {"adapters": {"any_of": ["api"]}}},
    }
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = _flatten_legacy_filterset_payload(raw)
    assert "query" not in result
    assert result["filter"]["adapters"] == ["api"]
    assert any(issubclass(c.category, DeprecationWarning) for c in caught)


def test_flatten_legacy_payload_does_not_warn_on_already_flat_payload():
    raw = {
        "name": "flat",
        "filter": {"datapoints": ["dp-1"]},
    }
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = _flatten_legacy_filterset_payload(raw)
    assert result == raw
    assert not [c for c in caught if issubclass(c.category, DeprecationWarning)]


def test_flatten_legacy_payload_returns_non_dict_passthrough():
    """Defensive: the shim should not blow up on non-dict input."""
    assert _flatten_legacy_filterset_payload([]) == []  # type: ignore[arg-type]
    assert _flatten_legacy_filterset_payload(None) is None  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "color, ok",
    [
        ("#3b82f6", True),
        ("#abc", True),
        ("#3B82F6FF", True),
        ("not-a-color", False),
        ("#XYZ", False),
        ("", False),
        ("3b82f6", False),
    ],
)
def test_color_validation(color, ok):
    from obs.api.v1.ringbuffer import RingBufferFiltersetIn
    from pydantic import ValidationError

    if ok:
        assert RingBufferFiltersetIn(name="x", color=color).color == color
    else:
        with pytest.raises(ValidationError):
            RingBufferFiltersetIn(name="x", color=color)


# ---------------------------------------------------------------------------
# FilterCriteria → RingBufferQueryV2 translation (used by the multi-query
# endpoint and the single-set query endpoint).
# ---------------------------------------------------------------------------


def test_filter_to_query_v2_maps_datapoints_and_adapters_to_or_lists():
    criteria = FilterCriteria(adapters=["api", "knx"], datapoints=["dp-1", "dp-2"])
    query = _filter_to_query_v2(criteria, None)
    assert query.filters.adapters is not None
    assert query.filters.adapters.any_of == ["api", "knx"]
    assert query.filters.datapoints is not None
    assert query.filters.datapoints.ids == ["dp-1", "dp-2"]


def test_filter_to_query_v2_maps_tags_to_metadata_or_list():
    criteria = FilterCriteria(tags=["a", "b"])
    query = _filter_to_query_v2(criteria, None)
    assert query.filters.metadata is not None
    assert query.filters.metadata.tags_any_of == ["a", "b"]


def test_filter_to_query_v2_propagates_value_filter():
    criteria = FilterCriteria(
        value_filter=RingBufferValueFilterV2(operator="gt", value=42),
    )
    query = _filter_to_query_v2(criteria, None)
    assert query.filters.values is not None
    assert len(query.filters.values) == 1
    assert query.filters.values[0].operator == "gt"
    assert query.filters.values[0].value == 42


def test_filter_to_query_v2_merges_time_filter():
    criteria = FilterCriteria(datapoints=["dp-1"])
    time = RingBufferTimeFilterV2(from_ts="2024-01-01T00:00:00Z")
    query = _filter_to_query_v2(criteria, time)
    assert query.filters.time is not None
    assert query.filters.time.from_ts == "2024-01-01T00:00:00Z"


def test_filter_to_query_v2_empty_criteria_yields_empty_filters():
    """An empty criteria must produce a query that returns the unfiltered feed."""
    query = _filter_to_query_v2(FilterCriteria(), None)
    assert query.filters.adapters is None
    assert query.filters.datapoints is None
    assert query.filters.metadata is None
    assert query.filters.values is None
    assert query.filters.time is None
    assert query.filters.q == ""


def test_filter_to_query_v2_q_is_forwarded():
    criteria = FilterCriteria(q="kitchen")
    query = _filter_to_query_v2(criteria, None)
    assert query.filters.q == "kitchen"


def test_filter_criteria_accepts_hierarchy_node_refs():
    """hierarchy_nodes is stored verbatim — server-side expansion is the UI's job."""
    criteria = FilterCriteria(
        hierarchy_nodes=[NodeRef(tree_id="knx-funcs", node_id="node-1", include_descendants=True)],
    )
    assert len(criteria.hierarchy_nodes) == 1
    assert criteria.hierarchy_nodes[0].tree_id == "knx-funcs"
    assert criteria.hierarchy_nodes[0].include_descendants is True


def test_filter_criteria_forbids_extras():
    """Typos in criteria field names must fail validation, not silently drop."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        FilterCriteria.model_validate({"datapoint_ids": ["dp-1"]})  # noqa: typo

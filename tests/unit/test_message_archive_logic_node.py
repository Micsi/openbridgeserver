from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from obs.adapters.message.providers.base import MessageSendResult
from obs.logic.manager import LogicManager, _fresh_input_handles
from obs.logic.models import FlowData
from obs.logic.node_types import get_node_type
from tests.unit.conftest import edge, node


def _flow(nodes: list[dict], edges: list[dict] | None = None) -> FlowData:
    return FlowData.model_validate({"nodes": nodes, "edges": edges or []})


def _make_manager() -> LogicManager:
    db = AsyncMock()
    db.fetchall = AsyncMock(return_value=[])
    db.execute_and_commit = AsyncMock()
    event_bus = AsyncMock()
    registry = MagicMock()
    registry.get_value.return_value = None
    return LogicManager(db, event_bus, registry)


def _run(manager: LogicManager, flow: FlowData, overrides: dict | None = None) -> dict:
    graph_id = "archive-graph"
    manager._graphs[graph_id] = ("Archiv Test", True, flow)
    manager._node_state[graph_id] = {}
    return asyncio.run(
        manager._execute_graph(
            graph_id,
            "Archiv Test",
            flow,
            overrides if overrides is not None else {"ma": {"trigger": True}},
        ),
    )


class _MockResponse:
    status_code = 200
    text = '{"ok": true}'

    def json(self):
        return {"ok": True}


def _patch_api_success():
    patcher = patch("obs.logic.manager.httpx.AsyncClient")
    mock_client_cls = patcher.start()
    mock_client = AsyncMock()
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
    mock_client.request = AsyncMock(return_value=_MockResponse())
    return patcher, mock_client


def test_fresh_input_traversal_handles_reverse_edges_and_converging_paths() -> None:
    edges = _flow(
        [],
        [
            edge("middle", "target", "out", "message"),
            edge("source", "target", "value", "trigger"),
            edge("source", "middle", "value", "in"),
        ],
    ).edges
    handles = _fresh_input_handles(
        {"source": {"value": "fresh"}},
        edges,
    )

    assert handles["target"] == {"message", "trigger"}


def test_fresh_input_traversal_uses_last_edge_for_duplicate_input_handle() -> None:
    edges = _flow(
        [],
        [
            edge("fresh_source", "target", "value", "message"),
            edge("cached_source", "target", "value", "message"),
        ],
    ).edges

    handles = _fresh_input_handles(
        {"fresh_source": {"value": "fresh"}},
        edges,
    )

    assert "target" not in handles


def test_message_archive_node_type_is_registered() -> None:
    node_type = get_node_type("message_archive")

    assert node_type is not None
    assert node_type.label == "Meldungsarchiv"
    assert any(port.id == "message" for port in node_type.inputs)
    assert any(port.id == "stored" for port in node_type.outputs)
    assert "critical" in node_type.config_schema["severity"]["enum"]


def test_message_archive_node_records_entry() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node(
                "ma",
                "message_archive",
                {
                    "archive_id": "Alerts",
                    "type": "automation",
                    "severity": "critical",
                    "title": "Fallback title",
                    "message": "Fallback message",
                },
            )
        ]
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"ma": {"trigger": True, "message": "Input message", "title": "Input title"}})

    assert outputs["ma"]["stored"] is True
    service.record.assert_awaited_once_with(
        "alerts",
        type="automation",
        severity="critical",
        source="logic.graph.archive-graph.node.ma",
        title="Input title",
        message="Input message",
        payload={
            "graph_id": "archive-graph",
            "graph_name": "Archiv Test",
            "node_id": "ma",
            "node_label": "",
        },
    )


def test_message_archive_stored_output_replays_downstream_nodes() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node("ma", "message_archive", {"archive_id": "Alerts", "message": "Stored"}),
            node("truth", "const_value", {"value": "true", "data_type": "bool"}),
            node("gate", "and", {"input_count": 2}),
        ],
        [
            edge("ma", "gate", "stored", "in1"),
            edge("truth", "gate", "value", "in2"),
        ],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"ma": {"trigger": True}})

    assert outputs["ma"]["stored"] is True
    assert outputs["gate"]["out"] is True


def test_message_archive_replay_runs_downstream_api_client() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node("ma", "message_archive", {"archive_id": "Alerts", "message": "Stored"}),
            node("api", "api_client", {"url": "http://93.184.216.34/hook", "method": "GET"}),
        ],
        [edge("ma", "api", "stored", "trigger")],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})
    patcher, mock_client = _patch_api_success()

    try:
        with (
            patch("obs.message_archive.get_message_archive_service", return_value=service),
            patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        ):
            outputs = _run(manager, flow, {"ma": {"trigger": True}})
    finally:
        patcher.stop()

    service.record.assert_awaited_once()
    mock_client.request.assert_awaited_once()
    assert outputs["ma"]["stored"] is True
    assert outputs["api"]["success"] is True


def test_message_archive_replay_runs_downstream_host_check_and_wol() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node("ma", "message_archive", {"archive_id": "Alerts", "message": "Stored"}),
            node("hc", "host_check", {"host": "192.168.1.1", "timeout_s": 1, "count": 1}),
            node("wol", "wake_on_lan", {"mac_address": "AA:BB:CC:DD:EE:FF"}),
        ],
        [
            edge("ma", "hc", "stored", "trigger"),
            edge("hc", "wol", "reachable", "trigger"),
        ],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        patch("obs.logic.manager._ping_host", new_callable=AsyncMock, return_value=(True, 1.0)) as mock_ping,
        patch("obs.logic.manager.asyncio.to_thread", new_callable=AsyncMock) as mock_to_thread,
    ):
        outputs = _run(manager, flow, {"ma": {"trigger": True}})

    service.record.assert_awaited_once()
    mock_ping.assert_awaited_once()
    mock_to_thread.assert_awaited_once()
    assert outputs["hc"]["reachable"] is True
    assert outputs["wol"]["sent"] is True


def test_message_archive_replay_holds_change_filter_behind_pending_wol() -> None:
    """Regression: _replay_async_descendants (used for message_archive/notify
    replays) registered a change_filter's pulse right after evaluating a
    downstream async node's PLACEHOLDER output, with no suppression for a
    still-pending sibling — unlike the api_client replay branch, which holds
    such a filter until the real result is known. Here wol.sent is a
    placeholder False in the first replay pass (wol hasn't actually sent
    yet); the persisted change_filter baseline is True, so a naive compare
    reports changed=True and a downstream host_check pings immediately —
    before wol's real send (which also settles to True, i.e. no real change)
    ever happens. The filter must stay held until wol actually runs, and
    since the real result matches the persisted baseline, host_check must
    never be triggered at all."""
    manager = _make_manager()
    flow = _flow(
        [
            node("ma", "message_archive", {"archive_id": "Alerts", "message": "Stored"}),
            node("wol", "wake_on_lan", {"mac_address": "AA:BB:CC:DD:EE:FF"}),
            node("cf", "change_filter", {}),
            node("hc", "host_check", {"host": "192.168.1.1", "timeout_s": 1, "count": 1}),
        ],
        [
            edge("ma", "wol", "stored", "trigger"),
            edge("wol", "cf", "sent", "in"),
            edge("cf", "hc", "changed", "trigger"),
        ],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})
    manager._hysteresis["archive-graph"] = {"cf": {"value": True}}

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        patch("obs.logic.manager._ping_host", new_callable=AsyncMock, return_value=(True, 1.0)) as mock_ping,
        patch("obs.logic.manager.asyncio.to_thread", new_callable=AsyncMock) as mock_to_thread,
    ):
        outputs = _run(manager, flow, {"ma": {"trigger": True}})

    mock_to_thread.assert_awaited_once()
    mock_ping.assert_not_awaited()
    assert outputs["wol"]["sent"] is True
    assert outputs["cf"]["changed"] is False


def test_message_archive_replay_runs_downstream_message_archive() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node("ma1", "message_archive", {"archive_id": "Alerts", "message": "Stored"}),
            node("ma2", "message_archive", {"archive_id": "Audit", "message": "Stored again"}),
        ],
        [edge("ma1", "ma2", "stored", "trigger")],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"ma1": {"trigger": True}})

    assert service.record.await_count == 2
    assert service.record.await_args_list[0].args[0] == "alerts"
    assert service.record.await_args_list[1].args[0] == "audit"
    assert outputs["ma1"]["stored"] is True
    assert outputs["ma2"]["stored"] is True


def test_notify_sent_output_replays_downstream_message_archive() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node("notify", "notify_pushover", {"app_token": "app-token", "user_key": "user-key", "message": "notify"}),
            node("ma", "message_archive", {"archive_id": "Alerts", "message": "Stored"}),
        ],
        [edge("notify", "ma", "sent", "trigger")],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})

    response = MagicMock()
    response.raise_for_status = MagicMock()
    patcher = patch("obs.logic.manager.httpx.AsyncClient")
    mock_client_cls = patcher.start()
    mock_client = AsyncMock()
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=response)

    try:
        with (
            patch("obs.message_archive.get_message_archive_service", return_value=service),
            patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        ):
            outputs = _run(manager, flow, {"notify": {"trigger": True}})
    finally:
        patcher.stop()

    mock_client.post.assert_awaited_once()
    service.record.assert_awaited_once()
    assert outputs["notify"]["sent"] is True
    assert outputs["ma"]["stored"] is True


def test_generic_notification_uses_message_adapter_and_requires_all_targets() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [
                        {"provider": "pushover", "target": "default"},
                        {"provider": "seven.io", "target": "admin"},
                    ],
                    "title": "Alarm",
                    "message": "Fallback",
                },
            )
        ]
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(
        return_value=[
            MessageSendResult("pushover", "default", True),
            MessageSendResult("seven.io", "admin", True),
        ]
    )

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"notify": {"trigger": True, "message": "Dynamic"}})

    assert outputs["notify"]["sent"] is True
    adapter.send_notification.assert_awaited_once_with(
        message="Dynamic",
        providers=flow.nodes[0].data["providers"],
        title="Alarm",
        priority=0,
    )


def test_datapoint_event_only_sends_notification_on_its_own_branch() -> None:
    manager = _make_manager()
    datapoint_ids = [str(uuid.uuid4()) for _ in range(3)]
    flow_nodes = []
    flow_edges = []
    for index, datapoint_id in enumerate(datapoint_ids, start=1):
        read_id = f"read{index}"
        notify_id = f"notify{index}"
        flow_nodes.extend(
            [
                node(read_id, "datapoint_read", {"datapoint_id": datapoint_id}),
                node(
                    notify_id,
                    "notify_message",
                    {
                        "adapter_instance_id": "message-1",
                        "providers": [{"provider": "telegram", "target": f"target{index}"}],
                    },
                ),
            ]
        )
        flow_edges.append(edge(read_id, notify_id, "value", "message"))
    flow = _flow(flow_nodes, flow_edges)

    registry_values = {
        uuid.UUID(datapoint_id): MagicMock(value=f"cached message {index}") for index, datapoint_id in enumerate(datapoint_ids, start=1)
    }
    manager._registry.get_value.side_effect = registry_values.get
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "target1", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"read1": {"value": "fresh message", "changed": True}})

    adapter.send_notification.assert_awaited_once_with(
        message="fresh message",
        providers=[{"provider": "telegram", "target": "target1"}],
        title=None,
        priority=0,
    )
    assert outputs["notify1"]["sent"] is True
    assert outputs["notify2"]["sent"] is False
    assert outputs["notify3"]["sent"] is False


def test_manual_execution_still_sends_cached_notification_branches() -> None:
    manager = _make_manager()
    datapoint_id = uuid.uuid4()
    manager._registry.get_value.return_value = MagicMock(value="manual alert")
    flow = _flow(
        [
            node("read", "datapoint_read", {"datapoint_id": str(datapoint_id)}),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [edge("read", "notify", "value", "message")],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {})

    assert outputs["notify"]["sent"] is True
    adapter.send_notification.assert_awaited_once_with(
        message="manual alert",
        providers=[{"provider": "telegram", "target": "alerts"}],
        title=None,
        priority=0,
    )


def test_notification_requires_fresh_truthy_trigger_when_message_is_cached() -> None:
    message_datapoint_id = uuid.uuid4()
    condition_datapoint_id = uuid.uuid4()
    flow = _flow(
        [
            node("message_read", "datapoint_read", {"datapoint_id": str(message_datapoint_id)}),
            node("condition_read", "datapoint_read", {"datapoint_id": str(condition_datapoint_id)}),
            node("condition", "compare", {"operator": ">", "operand": 10}),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("message_read", "notify", "value", "message"),
            edge("condition_read", "condition", "value", "in1"),
            edge("condition", "notify", "out", "trigger"),
        ],
    )

    for condition_value, should_send in ((5, False), (15, True)):
        manager = _make_manager()
        manager._registry.get_value.side_effect = {
            message_datapoint_id: MagicMock(value="cached alert"),
            condition_datapoint_id: MagicMock(value=0),
        }.get
        adapter = MagicMock(adapter_type="MESSAGE")
        adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

        with (
            patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
            patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        ):
            outputs = _run(
                manager,
                flow,
                {"condition_read": {"value": condition_value, "changed": True}},
            )

        assert outputs["notify"]["sent"] is should_send
        if should_send:
            adapter.send_notification.assert_awaited_once_with(
                message="cached alert",
                providers=[{"provider": "telegram", "target": "alerts"}],
                title=None,
                priority=0,
            )
        else:
            adapter.send_notification.assert_not_awaited()


def test_freshness_skipped_notify_settles_instead_of_holding_downstream_change_filter() -> None:
    """Regression (P2, issue #1087): a notify node with a truthy but STALE
    _trigger (message cached from a previous tick, not fed by THIS tick's
    event) is correctly skipped by _has_fresh_firing_input, but was never
    settled — a change_filter combining its output with a genuinely live
    input stayed held for the rest of the tick, hostage to a node that was
    never actually going to do anything, and the live input's genuine
    change was lost until some unrelated future tick happened to also
    settle it."""
    message_datapoint_id = uuid.uuid4()
    live_datapoint_id = uuid.uuid4()
    flow = _flow(
        [
            node("message_read", "datapoint_read", {"datapoint_id": str(message_datapoint_id)}),
            node(
                "notify",
                "notify_message",
                {"adapter_instance_id": "message-1", "providers": [{"provider": "telegram", "target": "alerts"}]},
            ),
            node("live_read", "datapoint_read", {"datapoint_id": str(live_datapoint_id)}),
            node("add", "math_formula", {"formula": "a + b"}),
            node("cf", "change_filter"),
        ],
        [
            edge("message_read", "notify", "value", "message"),
            edge("notify", "add", "sent", "in1"),
            edge("live_read", "add", "value", "in2"),
            edge("add", "cf", "result", "in"),
        ],
    )
    manager = _make_manager()
    manager._registry.get_value.side_effect = {
        message_datapoint_id: MagicMock(value="cached alert"),
        live_datapoint_id: MagicMock(value=1),
    }.get
    # Previous tick's committed state: notify.sent(False=0) + live_read(1) = 1.
    manager._hysteresis["archive-graph"] = {"cf": {"value": 1}}
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"live_read": {"value": 2, "changed": True}})

    # The cached message is stale for THIS event — notify must not fire.
    assert outputs["notify"]["sent"] is False
    adapter.send_notification.assert_not_awaited()
    # But the change_filter must still see the real Add result
    # (0 + 2 = 2) and report the genuine transition from its persisted
    # baseline of 1 — not stay held hostage to notify's own irrelevant,
    # never-going-to-fire trigger.
    assert outputs["cf"] == {"out": 2.0, "changed": True}


def test_freshness_skipped_notify_release_does_not_affect_a_separately_held_filter() -> None:
    """Regression: the late release pass (see test above) must only release
    a change_filter that was held SOLELY by the now-settled notify node —
    a SEPARATE change_filter still tainted by a genuinely unresolved,
    unrelated Read Object must stay held, proving the late release
    recomputes the hold set precisely rather than releasing everything in
    the original island indiscriminately. cf2 also starts with no prior
    persisted state at all, exercising the late release's own "clear the
    uncorrected first pass's wrongly-committed placeholder" branch (a
    held/suppressed filter never commits new state, mirroring the
    equivalent branch in the very first _cf_hold_ids correction)."""
    message_datapoint_id = uuid.uuid4()
    flow = _flow(
        [
            node("message_read", "datapoint_read", {"datapoint_id": str(message_datapoint_id)}),
            node(
                "notify",
                "notify_message",
                {"adapter_instance_id": "message-1", "providers": [{"provider": "telegram", "target": "alerts"}]},
            ),
            node("cf1", "change_filter"),
            node("unseeded_read", "datapoint_read", {}),  # no datapoint_id: always unseeded
            node("cf2", "change_filter"),
        ],
        [
            edge("message_read", "notify", "value", "message"),
            edge("notify", "cf1", "sent", "in"),
            edge("unseeded_read", "cf2", "value", "in"),
        ],
    )
    manager = _make_manager()
    manager._registry.get_value.side_effect = {message_datapoint_id: MagicMock(value="cached alert")}.get
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"live_unused": {"value": 1, "changed": True}})

    adapter.send_notification.assert_not_awaited()
    # cf1 was held only by notify's stale trigger — released once notify
    # settles, committing its first real value (notify never actually sent).
    assert outputs["cf1"] == {"out": False, "changed": True}
    # cf2 is tainted by a genuinely unresolved, unrelated Read Object and
    # must stay held (no prior state, so its held output is None) regardless.
    assert outputs["cf2"] == {"out": None, "changed": False}


def test_closed_gate_does_not_make_retained_message_fresh() -> None:
    message_datapoint_id = uuid.uuid4()
    enable_datapoint_id = uuid.uuid4()
    manager = _make_manager()
    manager._registry.get_value.side_effect = {
        message_datapoint_id: MagicMock(value="retained alert"),
        enable_datapoint_id: MagicMock(value=True),
    }.get
    flow = _flow(
        [
            node("message_read", "datapoint_read", {"datapoint_id": str(message_datapoint_id)}),
            node("enable_read", "datapoint_read", {"datapoint_id": str(enable_datapoint_id)}),
            node("gate", "gate", {"closed_behavior": "retain"}),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("message_read", "gate", "value", "in"),
            edge("enable_read", "gate", "value", "enable"),
            edge("gate", "notify", "out", "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        first_outputs = _run(
            manager,
            flow,
            {"message_read": {"value": "retained alert", "changed": True}},
        )
        adapter.send_notification.reset_mock()
        closed_outputs = _run(
            manager,
            flow,
            {"enable_read": {"value": False, "changed": True}},
        )

    assert first_outputs["notify"]["sent"] is True
    assert closed_outputs["notify"]["_message"] == "retained alert"
    assert closed_outputs["notify"]["sent"] is False
    adapter.send_notification.assert_not_awaited()


def test_closed_gate_default_value_is_a_fresh_message() -> None:
    message_datapoint_id = uuid.uuid4()
    enable_datapoint_id = uuid.uuid4()
    manager = _make_manager()
    manager._registry.get_value.side_effect = {
        message_datapoint_id: MagicMock(value="cached alert"),
        enable_datapoint_id: MagicMock(value=True),
    }.get
    flow = _flow(
        [
            node("message_read", "datapoint_read", {"datapoint_id": str(message_datapoint_id)}),
            node("enable_read", "datapoint_read", {"datapoint_id": str(enable_datapoint_id)}),
            node(
                "gate",
                "gate",
                {
                    "closed_behavior": "default_value",
                    "default_value": "default alert",
                },
            ),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("message_read", "gate", "value", "in"),
            edge("enable_read", "gate", "value", "enable"),
            edge("gate", "notify", "out", "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(
            manager,
            flow,
            {"enable_read": {"value": False, "changed": True}},
        )

    assert outputs["notify"]["sent"] is True
    adapter.send_notification.assert_awaited_once_with(
        message="default alert",
        providers=[{"provider": "telegram", "target": "alerts"}],
        title=None,
        priority=0,
    )


def test_closed_default_gate_ignores_fresh_data_input() -> None:
    message_datapoint_id = uuid.uuid4()
    enable_datapoint_id = uuid.uuid4()
    manager = _make_manager()
    manager._registry.get_value.side_effect = {
        message_datapoint_id: MagicMock(value="cached alert"),
        enable_datapoint_id: MagicMock(value=False),
    }.get
    flow = _flow(
        [
            node("message_read", "datapoint_read", {"datapoint_id": str(message_datapoint_id)}),
            node("enable_read", "datapoint_read", {"datapoint_id": str(enable_datapoint_id)}),
            node(
                "gate",
                "gate",
                {
                    "closed_behavior": "default_value",
                    "default_value": "default alert",
                },
            ),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("message_read", "gate", "value", "in"),
            edge("enable_read", "gate", "value", "enable"),
            edge("gate", "notify", "out", "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(
            manager,
            flow,
            {"message_read": {"value": "fresh but blocked", "changed": True}},
        )

    assert outputs["notify"]["_message"] == "default alert"
    assert outputs["notify"]["sent"] is False
    adapter.send_notification.assert_not_awaited()


def test_closed_default_gate_only_emits_default_on_transition() -> None:
    datapoint_id = uuid.uuid4()
    manager = _make_manager()
    flow = _flow(
        [
            node("read", "datapoint_read", {"datapoint_id": str(datapoint_id)}),
            node("condition", "compare", {"operator": ">", "operand": 10}),
            node(
                "gate",
                "gate",
                {
                    "closed_behavior": "default_value",
                    "default_value": "default alert",
                },
            ),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("read", "gate", "value", "in"),
            edge("read", "condition", "value", "in1"),
            edge("condition", "gate", "out", "enable"),
            edge("gate", "notify", "out", "message"),
        ],
    )
    graph_id = "default-gate-transition"
    manager._graphs[graph_id] = ("Default Gate", True, flow)
    manager._node_state[graph_id] = {}
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    async def execute(value: int) -> dict:
        return await manager._execute_graph(
            graph_id,
            "Default Gate",
            flow,
            {"read": {"value": value, "changed": True}},
        )

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        open_outputs = asyncio.run(execute(15))
        closed_outputs = asyncio.run(execute(5))
        still_closed_outputs = asyncio.run(execute(4))

    assert open_outputs["notify"]["sent"] is True
    assert closed_outputs["notify"]["sent"] is True
    assert closed_outputs["notify"]["_message"] == "default alert"
    assert still_closed_outputs["notify"]["sent"] is False
    assert adapter.send_notification.await_count == 2


def test_gate_freshness_is_recomputed_after_async_replay() -> None:
    archive_datapoint_id = uuid.uuid4()
    message_datapoint_id = uuid.uuid4()
    manager = _make_manager()
    manager._registry.get_value.side_effect = {
        archive_datapoint_id: MagicMock(value="archive event"),
        message_datapoint_id: MagicMock(value="cached alert"),
    }.get
    flow = _flow(
        [
            node("archive_read", "datapoint_read", {"datapoint_id": str(archive_datapoint_id)}),
            node("message_read", "datapoint_read", {"datapoint_id": str(message_datapoint_id)}),
            node("archive", "message_archive", {"archive_id": "Alerts"}),
            node("gate", "gate", {"closed_behavior": "retain"}),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("archive_read", "archive", "value", "message"),
            edge("message_read", "gate", "value", "in"),
            edge("archive", "gate", "stored", "enable"),
            edge("gate", "notify", "out", "message"),
        ],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(
            manager,
            flow,
            {"archive_read": {"value": "archive event", "changed": True}},
        )

    service.record.assert_awaited_once()
    assert outputs["archive"]["stored"] is True
    assert outputs["notify"]["sent"] is True
    adapter.send_notification.assert_awaited_once_with(
        message="cached alert",
        providers=[{"provider": "telegram", "target": "alerts"}],
        title=None,
        priority=0,
    )


def test_memory_output_is_not_fresh_during_its_input_tick() -> None:
    datapoint_id = uuid.uuid4()
    manager = _make_manager()
    manager._registry.get_value.return_value = MagicMock(value="new alert")
    flow = _flow(
        [
            node("read", "datapoint_read", {"datapoint_id": str(datapoint_id)}),
            node("memory", "memory", {"initial_value": "old alert", "data_type": "string"}),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("read", "memory", "value", "in"),
            edge("memory", "notify", "out", "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"read": {"value": "new alert", "changed": True}})

    assert outputs["notify"]["_message"] == "old alert"
    assert outputs["notify"]["sent"] is False
    adapter.send_notification.assert_not_awaited()


@pytest.mark.parametrize(
    ("action_type", "action_data", "result_handle"),
    [
        ("api_client", {"url": "http://93.184.216.34/hook", "method": "GET"}, "success"),
        ("host_check", {"host": "192.168.1.1"}, "reachable"),
        ("wake_on_lan", {"mac_address": "AA:BB:CC:DD:EE:FF"}, "sent"),
    ],
)
def test_untriggered_async_action_placeholder_is_not_a_fresh_message(
    action_type: str,
    action_data: dict,
    result_handle: str,
) -> None:
    datapoint_id = uuid.uuid4()
    manager = _make_manager()
    manager._registry.get_value.return_value = MagicMock(value=5)
    flow = _flow(
        [
            node("read", "datapoint_read", {"datapoint_id": str(datapoint_id)}),
            node("condition", "compare", {"operator": ">", "operand": 10}),
            node("action", action_type, action_data),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("read", "condition", "value", "in1"),
            edge("condition", "action", "out", "trigger"),
            edge("action", "notify", result_handle, "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"read": {"value": 5, "changed": True}})

    assert outputs["notify"]["_message"] is False
    assert outputs["notify"]["sent"] is False
    adapter.send_notification.assert_not_awaited()


def test_untriggered_random_value_does_not_become_a_coerced_fresh_message() -> None:
    datapoint_id = uuid.uuid4()
    manager = _make_manager()
    manager._registry.get_value.return_value = MagicMock(value=5)
    flow = _flow(
        [
            node("read", "datapoint_read", {"datapoint_id": str(datapoint_id)}),
            node("condition", "compare", {"operator": ">", "operand": 10}),
            node("random", "random_value", {"min": 1, "max": 10}),
            node("concat", "string_concat", {"count": 2, "text_2": " prefix"}),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("read", "condition", "value", "in1"),
            edge("condition", "random", "out", "trigger"),
            edge("random", "concat", "value", "in_1"),
            edge("concat", "notify", "result", "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"read": {"value": 5, "changed": True}})

    assert outputs["notify"]["_message"] == " prefix"
    assert outputs["notify"]["sent"] is False
    adapter.send_notification.assert_not_awaited()


def test_empty_value_mapping_result_does_not_become_a_coerced_fresh_message() -> None:
    datapoint_id = uuid.uuid4()
    manager = _make_manager()
    flow = _flow(
        [
            node("read", "datapoint_read", {"datapoint_id": str(datapoint_id)}),
            node(
                "mapping",
                "value_mapping",
                {
                    "output_type": "string",
                    "rules": [{"operator": "eq", "value": "alert", "result": "mapped alert"}],
                    "has_default": False,
                },
            ),
            node("concat", "string_concat", {"count": 2, "text_2": " prefix"}),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("read", "mapping", "value", "value"),
            edge("mapping", "concat", "result", "in_1"),
            edge("concat", "notify", "result", "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(
            manager,
            flow,
            {"read": {"value": "not-an-alert", "changed": True}},
        )

    assert outputs["mapping"]["result"] is None
    assert outputs["notify"]["_message"] == " prefix"
    assert outputs["notify"]["sent"] is False
    adapter.send_notification.assert_not_awaited()


def test_fresh_null_reaches_value_mapping_default() -> None:
    datapoint_id = uuid.uuid4()
    manager = _make_manager()
    flow = _flow(
        [
            node("read", "datapoint_read", {"datapoint_id": str(datapoint_id)}),
            node(
                "mapping",
                "value_mapping",
                {
                    "output_type": "string",
                    "rules": [{"operator": "eq", "value": "alert", "result": "mapped alert"}],
                    "has_default": True,
                    "default_value": "cleared",
                },
            ),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("read", "mapping", "value", "value"),
            edge("mapping", "notify", "result", "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(
            manager,
            flow,
            {"read": {"value": None, "changed": True}},
        )

    assert outputs["mapping"]["result"] == "cleared"
    assert outputs["notify"]["sent"] is True
    adapter.send_notification.assert_awaited_once_with(
        message="cleared",
        providers=[{"provider": "telegram", "target": "alerts"}],
        title=None,
        priority=0,
    )


def test_failed_scheduled_ical_refresh_does_not_send_cached_calendar() -> None:
    manager = _make_manager()
    url = "https://example.com/calendar.ics"
    cached_calendar = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"
    manager._hysteresis["archive-graph"] = {
        "calendar": {
            "raw": cached_calendar,
            "fetched_url": url,
            "last_fetch_ts": 0,
        },
    }
    flow = _flow(
        [
            node("calendar", "ical", {"url": url, "filters": "[]", "filter_count": 0}),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [edge("calendar", "notify", "raw", "message")],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.logic.manager._build_ical_fetch_targets", side_effect=RuntimeError("calendar unavailable")),
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"calendar": {}})

    assert outputs["calendar"]["raw"] == cached_calendar
    assert outputs["notify"]["sent"] is False
    adapter.send_notification.assert_not_awaited()


def test_scheduled_ical_execution_attributes_every_successful_refresh() -> None:
    manager = _make_manager()
    calendar_body = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"
    flow = _flow(
        [
            node("calendar_a", "ical", {"url": "https://a.example/calendar.ics", "filters": "[]", "filter_count": 0}),
            node("calendar_b", "ical", {"url": "https://b.example/calendar.ics", "filters": "[]", "filter_count": 0}),
            node(
                "notify_a",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "a"}],
                },
            ),
            node(
                "notify_b",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "b"}],
                },
            ),
        ],
        [
            edge("calendar_a", "notify_a", "raw", "message"),
            edge("calendar_b", "notify_b", "raw", "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    class Headers:
        @staticmethod
        def get(name: str, default=None):
            return {"content-type": "text/calendar"}.get(name.lower(), default)

        @staticmethod
        def get_list(_name: str) -> list[str]:
            return []

    class Response:
        status_code = 200
        headers = Headers()

        @staticmethod
        def raise_for_status() -> None:
            return None

        @staticmethod
        async def aiter_bytes():
            yield calendar_body

    class StreamContext:
        async def __aenter__(self):
            return Response()

        async def __aexit__(self, _exc_type, _exc, _tb):
            return False

    client = MagicMock()
    client.stream.return_value = StreamContext()
    client.aclose = AsyncMock()

    with (
        patch(
            "obs.logic.manager._build_ical_fetch_targets",
            return_value=(["https://93.184.216.34/calendar.ics"], {}, {}),
        ),
        patch("obs.logic.manager.httpx.AsyncClient", return_value=client),
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"calendar_a": {}})

    assert outputs["notify_a"]["sent"] is True
    assert outputs["notify_b"]["sent"] is True
    assert adapter.send_notification.await_count == 2


def test_duplicate_input_edges_do_not_send_cached_effective_message() -> None:
    fresh_datapoint_id = uuid.uuid4()
    cached_datapoint_id = uuid.uuid4()
    manager = _make_manager()
    manager._registry.get_value.side_effect = {
        fresh_datapoint_id: MagicMock(value="fresh"),
        cached_datapoint_id: MagicMock(value="cached"),
    }.get
    flow = _flow(
        [
            node("fresh_read", "datapoint_read", {"datapoint_id": str(fresh_datapoint_id)}),
            node("cached_read", "datapoint_read", {"datapoint_id": str(cached_datapoint_id)}),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("fresh_read", "notify", "value", "message"),
            edge("cached_read", "notify", "value", "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(
            manager,
            flow,
            {"fresh_read": {"value": "fresh", "changed": True}},
        )

    assert outputs["notify"]["_message"] == "cached"
    assert outputs["notify"]["sent"] is False
    adapter.send_notification.assert_not_awaited()


def test_cached_host_check_result_does_not_resend_notification() -> None:
    datapoint_id = uuid.uuid4()
    manager = _make_manager()
    flow = _flow(
        [
            node("read", "datapoint_read", {"datapoint_id": str(datapoint_id)}),
            node("condition", "compare", {"operator": ">", "operand": 10}),
            node("host", "host_check", {"host": "192.0.2.1", "timeout_s": 1, "count": 1}),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("read", "condition", "value", "in1"),
            edge("condition", "host", "out", "trigger"),
            edge("host", "notify", "reachable", "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.logic.manager._ping_host", new_callable=AsyncMock, return_value=(True, 2.0)) as mock_ping,
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        first_outputs = _run(
            manager,
            flow,
            {"read": {"value": 11, "changed": True}},
        )
        second_outputs = _run(
            manager,
            flow,
            {"read": {"value": 12, "changed": True}},
        )

    assert first_outputs["notify"]["sent"] is True
    assert second_outputs["host"]["reachable"] is True
    assert second_outputs["notify"]["sent"] is False
    assert mock_ping.await_count == 1
    assert adapter.send_notification.await_count == 1


def test_notification_chain_waits_for_sent_output_replay() -> None:
    datapoint_id = uuid.uuid4()
    manager = _make_manager()
    manager._registry.get_value.return_value = MagicMock(value="fresh alert")
    flow = _flow(
        [
            node("read", "datapoint_read", {"datapoint_id": str(datapoint_id)}),
            node(
                "notify_a",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "first"}],
                },
            ),
            node(
                "notify_b",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "second"}],
                },
            ),
        ],
        [
            edge("read", "notify_a", "value", "message"),
            edge("notify_a", "notify_b", "sent", "message"),
        ],
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(
        side_effect=[
            [MessageSendResult("telegram", "first", True)],
            [MessageSendResult("telegram", "second", True)],
        ]
    )

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(
            manager,
            flow,
            {"read": {"value": "fresh alert", "changed": True}},
        )

    assert outputs["notify_a"]["sent"] is True
    assert outputs["notify_b"]["sent"] is True
    assert [call.kwargs["message"] for call in adapter.send_notification.await_args_list] == [
        "fresh alert",
        "True",
    ]


def test_archive_requires_fresh_truthy_trigger_when_message_is_cached() -> None:
    message_datapoint_id = uuid.uuid4()
    condition_datapoint_id = uuid.uuid4()
    manager = _make_manager()
    manager._registry.get_value.side_effect = {
        message_datapoint_id: MagicMock(value="cached archive alert"),
        condition_datapoint_id: MagicMock(value=5),
    }.get
    flow = _flow(
        [
            node("message_read", "datapoint_read", {"datapoint_id": str(message_datapoint_id)}),
            node("condition_read", "datapoint_read", {"datapoint_id": str(condition_datapoint_id)}),
            node("condition", "compare", {"operator": ">", "operand": 10}),
            node("archive", "message_archive", {"archive_id": "Alerts"}),
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "alerts"}],
                },
            ),
        ],
        [
            edge("message_read", "archive", "value", "message"),
            edge("condition_read", "condition", "value", "in1"),
            edge("condition", "archive", "out", "trigger"),
            edge("archive", "notify", "stored", "message"),
        ],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("telegram", "alerts", True)])

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(
            manager,
            flow,
            {"condition_read": {"value": 5, "changed": True}},
        )

    assert outputs["archive"]["stored"] is False
    assert outputs["notify"]["sent"] is False
    service.record.assert_not_awaited()
    adapter.send_notification.assert_not_awaited()


def test_generic_notification_reports_target_failure() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node(
                "notify",
                "notify_message",
                {
                    "adapter_instance_id": "message-1",
                    "providers": [{"provider": "telegram", "target": "family"}],
                    "message": "Alarm",
                },
            )
        ]
    )
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(
        return_value=[
            MessageSendResult("telegram", "family", False, "provider disabled"),
        ]
    )

    with (
        patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"notify": {"trigger": True}})

    assert outputs["notify"]["sent"] is False
    assert "provider disabled" in outputs["notify"]["__error__"]


def test_generic_notification_defaults_blank_priority_and_clamps_range() -> None:
    manager = _make_manager()
    adapter = MagicMock(adapter_type="MESSAGE")
    adapter.send_notification = AsyncMock(return_value=[MessageSendResult("dummy", "target", True)])

    for priority, expected in [("", 0), (None, 0), ("invalid", 0), (99, 1), (-99, -2)]:
        flow = _flow(
            [
                node(
                    "notify",
                    "notify_message",
                    {
                        "adapter_instance_id": "message-1",
                        "providers": [{"provider": "dummy", "target": "target"}],
                        "priority": priority,
                    },
                )
            ]
        )
        with (
            patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
            patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        ):
            outputs = _run(manager, flow, {"notify": {"trigger": True}})

        assert outputs["notify"]["sent"] is True
        assert adapter.send_notification.await_args.kwargs["priority"] == expected


def test_generic_notification_rejects_missing_configuration() -> None:
    manager = _make_manager()
    flow = _flow([node("notify", "notify_message", {})])

    with patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")):
        outputs = _run(manager, flow, {"notify": {"trigger": True}})

    assert outputs["notify"]["sent"] is False
    assert "at least one target" in outputs["notify"]["__error__"]


def test_generic_notification_rejects_unavailable_or_wrong_adapter() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node(
                "notify",
                "notify_message",
                {"adapter_instance_id": "missing", "providers": [{"provider": "dummy", "target": "target"}]},
            )
        ]
    )

    for adapter in (None, MagicMock(adapter_type="MQTT")):
        with (
            patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
            patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        ):
            outputs = _run(manager, flow, {"notify": {"trigger": True}})
        assert "unavailable" in outputs["notify"]["__error__"]


def test_generic_notification_reports_no_results_and_adapter_exception() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node(
                "notify",
                "notify_message",
                {"adapter_instance_id": "message-1", "providers": [{"provider": "dummy", "target": "target"}]},
            )
        ]
    )
    adapter = MagicMock(adapter_type="MESSAGE")

    for result, message in [([], "did not process"), (RuntimeError("boom"), "boom")]:
        adapter.send_notification = AsyncMock(side_effect=result if isinstance(result, Exception) else None, return_value=result)
        with (
            patch("obs.adapters.registry.get_instance_by_id", return_value=adapter),
            patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        ):
            outputs = _run(manager, flow, {"notify": {"trigger": True}})
        assert message in outputs["notify"]["__error__"]


def test_pushover_missing_credentials_releases_held_change_filter() -> None:
    """Regression: a change_filter held behind notify_pushover must still be
    released when app_token/user_key are missing — that's a permanent
    misconfiguration, not a transient failure, so the manager must mark the
    node "resolved" even though it never actually sent, or the filter would
    stay held forever instead of showing its real (here: first) value."""
    manager = _make_manager()
    flow = _flow(
        [node("notify", "notify_pushover", {}), node("cf", "change_filter")],
        [edge("notify", "cf", "sent", "in")],
    )

    with patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")):
        outputs = _run(manager, flow, {"notify": {"trigger": True}})

    assert outputs["notify"]["sent"] is False
    assert outputs["cf"]["out"] is False
    assert outputs["cf"]["changed"] is True


def test_sms_missing_credentials_releases_held_change_filter() -> None:
    """Same as the Pushover case above, for notify_sms's api_key/to check."""
    manager = _make_manager()
    flow = _flow(
        [node("notify", "notify_sms", {}), node("cf", "change_filter")],
        [edge("notify", "cf", "sent", "in")],
    )

    with patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")):
        outputs = _run(manager, flow, {"notify": {"trigger": True}})

    assert outputs["notify"]["sent"] is False
    assert outputs["cf"]["out"] is False
    assert outputs["cf"]["changed"] is True


def test_notify_sent_output_replays_downstream_notify() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node("notify1", "notify_pushover", {"app_token": "app-token", "user_key": "user-key", "message": "first"}),
            node("notify2", "notify_pushover", {"app_token": "app-token", "user_key": "user-key", "message": "second"}),
        ],
        [edge("notify1", "notify2", "sent", "trigger")],
    )

    response = MagicMock()
    response.raise_for_status = MagicMock()
    patcher = patch("obs.logic.manager.httpx.AsyncClient")
    mock_client_cls = patcher.start()
    mock_client = AsyncMock()
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=response)

    try:
        with patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")):
            outputs = _run(manager, flow, {"notify1": {"trigger": True}})
    finally:
        patcher.stop()

    assert mock_client.post.await_count == 2
    assert outputs["notify1"]["sent"] is True
    assert outputs["notify2"]["sent"] is True


def test_message_archive_replayed_notify_is_not_sent_again_in_main_pass() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node("ma", "message_archive", {"archive_id": "Alerts", "message": "Stored"}),
            node("notify", "notify_pushover", {"app_token": "app-token", "user_key": "user-key", "message": "notify"}),
        ],
        [edge("ma", "notify", "stored", "trigger")],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})
    response = MagicMock()
    response.raise_for_status = MagicMock()
    patcher = patch("obs.logic.manager.httpx.AsyncClient")
    mock_client_cls = patcher.start()
    mock_client = AsyncMock()
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=response)

    try:
        with (
            patch("obs.message_archive.get_message_archive_service", return_value=service),
            patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        ):
            outputs = _run(manager, flow, {"ma": {"trigger": True}})
    finally:
        patcher.stop()

    assert mock_client.post.await_count == 1
    assert outputs["ma"]["stored"] is True
    assert outputs["notify"]["sent"] is True


def test_message_archive_replayed_failed_notify_is_not_sent_again_in_main_pass() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node("ma", "message_archive", {"archive_id": "Alerts", "message": "Stored"}),
            node("notify", "notify_pushover", {"app_token": "app-token", "user_key": "user-key", "message": "notify"}),
        ],
        [edge("ma", "notify", "stored", "trigger")],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})
    response = MagicMock()
    response.raise_for_status = MagicMock(side_effect=RuntimeError("pushover down"))
    patcher = patch("obs.logic.manager.httpx.AsyncClient")
    mock_client_cls = patcher.start()
    mock_client = AsyncMock()
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=response)

    try:
        with (
            patch("obs.message_archive.get_message_archive_service", return_value=service),
            patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        ):
            outputs = _run(manager, flow, {"ma": {"trigger": True}})
    finally:
        patcher.stop()

    assert mock_client.post.await_count == 1
    assert outputs["ma"]["stored"] is True
    assert outputs["notify"]["sent"] is False


def test_notify_replay_snapshots_stateful_descendants_before_placeholder_pass() -> None:
    manager = _make_manager()
    flow = _flow(
        [
            node("notify", "notify_pushover", {"app_token": "app-token", "user_key": "user-key", "message": "notify"}),
            node("stats", "statistics", {}),
        ],
        [edge("notify", "stats", "sent", "value")],
    )

    response = MagicMock()
    response.raise_for_status = MagicMock()
    patcher = patch("obs.logic.manager.httpx.AsyncClient")
    mock_client_cls = patcher.start()
    mock_client = AsyncMock()
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=response)

    try:
        with patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")):
            outputs = _run(manager, flow, {"notify": {"trigger": True}})
    finally:
        patcher.stop()

    assert outputs["notify"]["sent"] is True
    assert outputs["stats"]["count"] == 1
    assert outputs["stats"]["avg"] == 1.0


def test_message_archive_node_does_not_record_without_trigger() -> None:
    manager = _make_manager()
    flow = _flow([node("ma", "message_archive", {"archive_id": "Alerts", "message": "Fallback"})])
    service = MagicMock()
    service.record = AsyncMock()

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"ma": {"trigger": False}})

    assert outputs["ma"]["stored"] is False
    service.record.assert_not_awaited()


def test_message_archive_node_keeps_stored_false_when_record_fails() -> None:
    manager = _make_manager()
    flow = _flow([node("ma", "message_archive", {"archive_id": "Alerts", "message": "Fallback"})])
    service = MagicMock()
    service.record = AsyncMock(side_effect=RuntimeError("archive unavailable"))

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow, {"ma": {"trigger": True}})

    assert outputs["ma"]["stored"] is False
    service.record.assert_awaited_once()


def test_message_archive_node_does_not_record_without_archive() -> None:
    manager = _make_manager()
    flow = _flow([node("ma", "message_archive", {"archive_id": "", "message": "Fallback"})])
    service = MagicMock()
    service.record = AsyncMock()

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
    ):
        outputs = _run(manager, flow)

    assert outputs["ma"]["stored"] is False
    service.record.assert_not_awaited()


def test_change_filter_pulse_via_title_does_not_retrigger_downstream_host_check() -> None:
    """Regression: message_archive's "trigger" input port was declared
    without type="trigger" (unlike its own "stored" output and unlike
    notify_message's equivalent input), so _edge_carries_pulse's
    has_trigger_input check found no trigger-tagged input port at all and
    let *every* edge into message_archive — including one landing on the
    unrelated "title" data port — count as pulse-carrying. A change_filter
    wired only to "title" would then falsely make message_archive (and
    anything downstream of its own separately sustained "stored" trigger,
    such as a host_check) look cron/pulse-reachable, bypassing rising-edge
    dedup and re-pinging on every title change even though the archive's
    own trigger never rose again."""
    manager = _make_manager()
    flow = _flow(
        [
            node("cf", "change_filter"),
            node("ma", "message_archive", {"archive_id": "Alerts", "message": "Stored"}),
            node("hc", "host_check", {"host": "192.168.1.1", "timeout_s": 1, "count": 1}),
        ],
        [
            edge("cf", "ma", "changed", "title"),
            edge("ma", "hc", "stored", "trigger"),
        ],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        patch("obs.logic.manager._ping_host", new_callable=AsyncMock, return_value=(True, 1.0)) as mock_ping,
    ):
        _run(manager, flow, {"ma": {"trigger": True}, "cf": {"in": 1}})
        _run(manager, flow, {"ma": {"trigger": True}, "cf": {"in": 2}})

    mock_ping.assert_awaited_once()


def test_change_filter_pulse_via_message_retriggers_downstream_host_check() -> None:
    """Regression: message_archive (and notify_pushover/notify_sms/
    notify_message) fire when a message arrives regardless of "trigger" —
    "message" is therefore an auto-triggering port in its own right, not a
    plain data port like "title". Declaring only "trigger" as trigger-typed
    made _edge_carries_pulse reject a pulse landing on "message" too, so a
    change_filter wired to message_archive.message could never make a
    downstream host_check look cron/pulse-reachable — every real message
    change was wrongly deduplicated as a "sustained" trigger after the
    first one."""
    manager = _make_manager()
    flow = _flow(
        [
            node("cf", "change_filter"),
            node("ma", "message_archive", {"archive_id": "Alerts", "title": "Stored"}),
            node("hc", "host_check", {"host": "192.168.1.1", "timeout_s": 1, "count": 1}),
        ],
        [
            edge("cf", "ma", "changed", "message"),
            edge("ma", "hc", "stored", "trigger"),
        ],
    )
    service = MagicMock()
    service.record = AsyncMock(return_value={"id": "entry-1"})

    with (
        patch("obs.message_archive.get_message_archive_service", return_value=service),
        patch("obs.api.v1.websocket.get_ws_manager", side_effect=RuntimeError("no ws")),
        patch("obs.logic.manager._ping_host", new_callable=AsyncMock, return_value=(True, 1.0)) as mock_ping,
    ):
        _run(manager, flow, {"cf": {"in": 1}})
        _run(manager, flow, {"cf": {"in": 2}})

    assert mock_ping.await_count == 2

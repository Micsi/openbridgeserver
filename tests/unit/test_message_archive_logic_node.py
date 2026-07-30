from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from obs.adapters.message.providers.base import MessageSendResult
from obs.logic.manager import LogicManager
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

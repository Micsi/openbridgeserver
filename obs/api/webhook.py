"""HTTP entry point for WEBHOOK adapter triggers (issue #1256).

The trigger endpoint deliberately lives outside ``/api/v1``:

* It carries **no principal**.  The caller is a device that can do nothing but
  fetch a URL — no headers, no body.  Its authority is a per-binding secret
  bound to a single DataPoint, which is the same shape as the anonymous Visu
  write path, not a third principal type in the RBAC model.
* It is therefore invisible to ``tools/check_authz_contract.py``, which walks
  ``/api/v1`` routes and verifies principal-based authorization.  That is
  correct rather than an oversight — there is no principal to authorize — and
  it is why *managing* webhook bindings stays on ``/api/v1`` routes that the
  gate does see.

It is dispatched by a middleware rather than a FastAPI route because the path
prefix is per-instance configuration that can change at runtime, and a
catch-all route at the application root would shadow the Admin-GUI's own
history-mode paths.  A request that no running instance claims is handed back
to the normal stack untouched.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi.responses import JSONResponse, Response

if TYPE_CHECKING:  # pragma: no cover - typing only
    from fastapi import Request

# OPTIONS stays with the normal stack so the CORS layer can answer preflights.
# Every other method that reaches a claimed prefix is answered here, so a
# device never receives the Admin-GUI shell instead of a status code.
_PASSTHROUGH_METHODS = frozenset({"OPTIONS"})
_TRIGGER_METHODS = frozenset({"GET", "POST"})


async def _read_capped_body(request: Request) -> bytes | None:
    """Read the body, or return None as soon as it exceeds the webhook limit.

    This runs before the token is checked, so an unauthenticated caller must not
    be able to make the server buffer an arbitrary amount of data: the declared
    length is checked up front and the stream is cut off at the limit for a
    client that lies about it or sends chunked.
    """
    from obs.adapters.webhook.adapter import MAX_BODY_BYTES

    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return None
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


async def handle_webhook_request(request: Request) -> Response | None:
    """Answer *request* if a running WEBHOOK instance claims its path."""
    from obs.adapters.webhook.adapter import resolve_webhook_target

    if request.method in _PASSTHROUGH_METHODS:
        return None
    target = resolve_webhook_target(request.url.path)
    if target is None:
        return None

    instance, remainder = target
    if request.method not in _TRIGGER_METHODS:
        return JSONResponse({"detail": "Not found"}, status_code=404)

    body = b""
    if request.method == "POST":
        body = await _read_capped_body(request)
        if body is None:
            return JSONResponse({"detail": "Request body is too large"}, status_code=413)
    outcome = await instance.handle_trigger(
        method=request.method,
        remainder=remainder,
        query_params=dict(request.query_params),
        body=body,
        peer_ip=request.client.host if request.client else None,
        forwarded_for=request.headers.get("X-Forwarded-For"),
    )
    if outcome.status == 204:
        return Response(status_code=204)
    return JSONResponse({"detail": outcome.detail}, status_code=outcome.status)

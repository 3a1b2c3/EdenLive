# SPDX-License-Identifier: Apache-2.0
"""``/ext/workbench/``: the three-step workbench, mounted on the WebRTC page.

Rank zero only. ``api/*`` is forwarded to the workbench bridge on the
``claude`` host with the shared token; ``render`` calls the FLUX worker on this
pod. Images come straight from ``games/`` on the shared filesystem.

    EDEN_WORKBENCH_BRIDGE   bridge base URL, e.g. http://<bridge-host>:8091
    EDEN_WORKBENCH_TOKEN    shared secret the bridge requires
    EDEN_WORKBENCH_FLUX     FLUX worker base URL (default http://127.0.0.1:8092)

Like every extension, these routes are reachable by anyone who can reach the
WebRTC port; the token only keeps the bridge from being driven directly.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import aiohttp
from aiohttp import web

from flashdreams.runtime_v2.serving.extensions import (
    register_http_extension,
    unregister_http_extension,
)

from .import_game import _SLUG, games_root

EXTENSION_NAME = "workbench"
_STATIC = Path(__file__).resolve().parent / "static"
_IMAGE = re.compile(r"^(coarse|cover|fine_\d{1,10})\.png$")
_TIMEOUT = aiohttp.ClientTimeout(total=600)


def _bridge() -> str:
    return os.environ.get("EDEN_WORKBENCH_BRIDGE", "").rstrip("/")


def _flux() -> str:
    return os.environ.get("EDEN_WORKBENCH_FLUX", "http://127.0.0.1:8092").rstrip("/")


async def _forward(request: web.Request, url: str, *, token: bool) -> web.Response:
    headers = {"content-type": "application/json"}
    if token:
        headers["X-Workbench-Token"] = os.environ.get("EDEN_WORKBENCH_TOKEN", "")
    body = await request.read() if request.method == "POST" else None
    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as client:
            async with client.request(request.method, url, data=body, headers=headers) as response:
                payload = await response.read()
                if response.status >= 400 and not payload:
                    payload = json.dumps({"error": response.reason}).encode()
                return web.Response(
                    body=payload, status=response.status, content_type="application/json"
                )
    except aiohttp.ClientError as error:
        raise web.HTTPBadGateway(reason=f"Workbench backend unreachable: {error}") from error


def _game_image(slug: str, name: str) -> Path:
    if not _SLUG.fullmatch(slug) or not _IMAGE.fullmatch(name):
        raise web.HTTPNotFound()
    path = games_root() / slug / name
    if not path.is_file():
        raise web.HTTPNotFound()
    return path


async def _render(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except json.JSONDecodeError as error:
        raise web.HTTPBadRequest(reason="Expected a JSON object.") from error
    slug = str(payload.get("slug", ""))
    coarse = _game_image(slug, "coarse.png")
    seed = int(payload.get("seed", 12345)) % 10**10
    body = {
        "coarse": str(coarse),
        "out": str(coarse.with_name(f"fine_{seed}.png")),
        "caption": str(payload.get("caption", "")),
        "seed": seed,
    }
    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as client:
            async with client.post(f"{_flux()}/render", json=body) as response:
                result = await response.json(content_type=None) if response.status < 400 else None
                if result is None:
                    raise web.HTTPBadGateway(reason=f"FLUX worker: {response.reason}")
    except aiohttp.ClientError as error:
        raise web.HTTPBadGateway(reason=f"FLUX worker unreachable: {error}") from error
    return web.json_response({**result, "image": Path(result["image"]).name})


async def handle_workbench(request: web.Request, tail: str) -> web.StreamResponse:
    """Dispatch one ``/ext/workbench/<tail>`` request."""
    if tail == "workbench.js":
        return web.Response(body=(_STATIC / "workbench.js").read_bytes(), content_type="text/javascript")
    if tail.startswith("api/"):
        if not _bridge():
            raise web.HTTPServiceUnavailable(reason="EDEN_WORKBENCH_BRIDGE is not set on the GPU server.")
        query = f"?{request.query_string}" if request.query_string else ""
        return await _forward(request, f"{_bridge()}/{tail}{query}", token=True)
    if tail == "flux/healthz":
        return await _forward(request, f"{_flux()}/healthz", token=False)
    if tail == "render" and request.method == "POST":
        return await _render(request)
    if tail.startswith("image/"):
        parts = tail.split("/")
        if len(parts) == 3:
            response = web.FileResponse(_game_image(parts[1], parts[2]))
            response.headers["Cache-Control"] = "no-store"
            return response
    raise web.HTTPNotFound()


def register_workbench() -> None:
    register_http_extension(EXTENSION_NAME, handle_workbench, client_script="workbench.js")


def unregister_workbench() -> None:
    unregister_http_extension(EXTENSION_NAME)

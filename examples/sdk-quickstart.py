#!/usr/bin/env python3
"""
Formatho Runtime — REST SDK quickstart (Python 3.9+, stdlib only).

Start the gateway first:
    FORMATHO_API_KEYS="devkey-1:local-agent" node dist/index.js --http
Then:
    python3 examples/sdk-quickstart.py
"""

import json
import os
import urllib.request
from dataclasses import dataclass

BASE_URL = os.environ.get("FORMATHO_URL", "http://127.0.0.1:8787")
API_KEY = os.environ.get("FORMATHO_KEY", "devkey-1")


@dataclass
class FormathoError(Exception):
    status: int
    body: dict

    def __str__(self) -> str:
        return f"{self.status}: {json.dumps(self.body)}"


class Formatho:
    """Minimal SDK: registry listing + tool invocation over REST."""

    def __init__(self, base_url: str = BASE_URL, api_key: str = API_KEY) -> None:
        self.base = base_url.rstrip("/")
        self.key = api_key

    def _request(self, path: str, body: dict | None = None) -> dict:
        req = urllib.request.Request(
            self.base + path,
            method="POST" if body is not None else "GET",
            headers={"Authorization": f"Bearer {self.key}"},
            data=json.dumps(body or {}).encode() if body is not None else None,
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode())
        except urllib.error.HTTPError as e:
            raise FormathoError(e.code, json.loads(e.read().decode() or "{}")) from None

    def tools(self) -> dict:
        """List the tools this API key is allowed to call, with input schemas."""
        return self._request("/api/tools")

    def call(self, name: str, **input) -> dict:
        """Invoke a tool by name — keyword arguments become the tool input."""
        return self._request(f"/api/tools/{name}", input)


if __name__ == "__main__":
    formatho = Formatho()

    registry = formatho.tools()
    print(f"registry: {len(registry.get('tools', []))} tools visible to this key")

    selector = formatho.call("evm.function_selector", signature="transfer(address,uint256)")
    print("selector:", selector["selector"])  # → 0xa9059cbb

    units = formatho.call("evm.unit_convert", value="1500000000", **{"from": "wei", "to": "gwei"})
    print("units:", units)

    digest = formatho.call("evm.keccak256", **{"data": "transfer(address,uint256)", "encoding": "utf8"})
    print("keccak256:", digest["hash"][:20] + "…")

    check = formatho.call("json.validate", **{"json": "{\"a\":1,}"})
    print("json valid:", check["valid"], check.get("parseError", ""))

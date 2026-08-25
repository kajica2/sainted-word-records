#!/usr/bin/env python3
"""tools/osc-bridge.py — OSC → WS bridge for Sainted Word Records.

Listens for OSC messages on UDP :9000 and forwards them as JSON to a
running visualizer-controller.js WS bridge (ws://HOST:8787).

OSC → WS mapping
----------------
  /VC/param <name:str> <value:float>   → {"type":"set","param":<name>,"value":<v>}
  /VC/action <name:str>                → {"type":"action","name":<name>}
  /VC/load  <version:str>              → {"type":"load","version":<version>}
  /VC/connect <host:str> <port:int>    → (re)connect the WS

Run:
  python3 tools/osc-bridge.py
  WS_HOST=192.168.1.42 OSC_PORT=9000 python3 tools/osc-bridge.py

Requirements (already in pip on the dev box):
  pip3 install --user python-osc websocket-client

Author: Kai Djuric · 2026-08-25
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time

import websocket  # websocket-client
from pythonosc import dispatcher as osc_dispatcher
from pythonosc import osc_server


WS_HOST_DEFAULT = "127.0.0.1"
WS_PORT_DEFAULT = 8787
OSC_PORT_DEFAULT = 9000


state = {
    "ws": None,
    "ws_url": None,
    "ws_lock": threading.Lock(),
}


def log(msg):
    print(f"[osc] {msg}", flush=True)


def ws_connect(host: str, port: int):
    url = f"ws://{host}:{port}"
    with state["ws_lock"]:
        if state["ws"]:
            try:
                state["ws"].close()
            except Exception:
                pass
        try:
            ws = websocket.create_connection(url, timeout=3)
            ws.send(json.dumps({
                "type": "hello",
                "role": "osc-bridge",
                "source": "osc-bridge.py",
            }))
            state["ws"] = ws
            state["ws_url"] = url
            log(f"ws connected to {url}")
        except Exception as e:
            state["ws"] = None
            log(f"ws connect {url} failed: {e}")


def ws_send(msg: dict):
    with state["ws_lock"]:
        ws = state["ws"]
        if not ws:
            log(f"ws not connected; dropping {msg.get('type')}")
            return False
        try:
            ws.send(json.dumps(msg))
            return True
        except Exception as e:
            log(f"ws send failed: {e}")
            state["ws"] = None
            return False


# OSC handlers — each registered to a /VC/* address.
# python-osc's dispatcher calls fn(handler_args, *osc_args). With map(),
# handler_args is the OSC address string. osc_args are the OSC args in
# order. For our protocol, /VC/param expects (name:str, value:float).
def on_param(addr, *args):
    if len(args) < 2:
        log(f"on_param needs (name, value); got {args}")
        return
    name, value = args[0], args[1]
    log(f"<- {addr} {name}={value}")
    ws_send({"type": "set", "param": str(name), "value": float(value)})


def on_action(addr, *args):
    if len(args) < 1:
        log(f"on_action needs a name; got {args}")
        return
    name = args[0]
    log(f"<- {addr} {name}")
    ws_send({"type": "action", "name": str(name)})


def on_load(addr, *args):
    if len(args) < 1:
        log(f"on_load needs a version; got {args}")
        return
    version = args[0]
    safe = "".join(c for c in str(version) if c.isalnum() or c in "-_")
    log(f"<- {addr} {safe}")
    ws_send({"type": "load", "version": safe})


def on_connect(addr, *args):
    if len(args) < 2:
        log(f"on_connect needs (host, port); got {args}")
        return
    host, port = args[0], args[1]
    log(f"<- {addr} {host}:{port}")
    ws_connect(str(host), int(port))


def main():
    ws_host = os.environ.get("WS_HOST", WS_HOST_DEFAULT)
    ws_port = int(os.environ.get("WS_PORT", WS_PORT_DEFAULT))
    osc_host = os.environ.get("OSC_HOST", "0.0.0.0")
    osc_port = int(os.environ.get("OSC_PORT", OSC_PORT_DEFAULT))

    # One dispatcher mapping /VC/* OSC addresses to handlers.
    disp = osc_dispatcher.Dispatcher()
    disp.map("/VC/param", on_param)
    disp.map("/VC/action", on_action)
    disp.map("/VC/load", on_load)
    disp.map("/VC/connect", on_connect)

    server = osc_server.ThreadingOSCUDPServer((osc_host, osc_port), disp)
    log(f"osc listening on udp {osc_host}:{osc_port}")

    ws_connect(ws_host, ws_port)
    # Background reconnect loop every 3s if the WS dropped.
    stop = threading.Event()
    def keep_alive():
        while not stop.is_set():
            if state["ws"] is None:
                ws_connect(ws_host, ws_port)
            time.sleep(3.0)
    threading.Thread(target=keep_alive, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("bye")
    finally:
        stop.set()
        server.shutdown()


if __name__ == "__main__":
    sys.exit(main() or 0)

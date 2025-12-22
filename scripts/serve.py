#!/usr/bin/env python3
"""Static file server for the ontology-driven UI."""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
from pathlib import Path
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the SintOlogy UI")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind")
    parser.add_argument("--root", default=".", help="Root directory to serve")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))

    with socketserver.TCPServer(("", args.port), handler) as httpd:
        print(f"Serving {root} at http://localhost:{args.port}/web/")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
            sys.exit(0)


if __name__ == "__main__":
    main()

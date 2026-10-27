#!/usr/bin/env python3
"""
Simple zero-dependency local static web server for testing GLB_PDF_floorplan Web.
Serves the production build located in dist/.
Usage: python server.py [port]
"""

import http.server
import socketserver
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def guess_type(self, path):
        if path.endswith('.glb'):
            return 'model/gltf-binary'
        if path.endswith('.gltf'):
            return 'model/gltf+json'
        if path.endswith('.wasm'):
            return 'application/wasm'
        return super().guess_type(path)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

if __name__ == '__main__':
    if not os.path.exists(DIRECTORY):
        print(f"Error: Production directory '{DIRECTORY}' not found.")
        print("Please run 'npm run build' first.")
        sys.exit(1)

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"============================================================")
        print(f"  GLB FloorPlan Extractor running locally at:")
        print(f"  --> http://localhost:{PORT}")
        print(f"============================================================")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")

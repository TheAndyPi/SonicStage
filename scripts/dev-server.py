"""Local static server for public/ that stops browsers from reusing stale app files."""

import functools
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class StudioServer(http.server.ThreadingHTTPServer):
    # The page requests ~20 scripts at once; the default backlog of 5 drops some of them.
    request_queue_size = 128


port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
handler = functools.partial(NoCacheHandler, directory="public")
print(f"Serving public/ at http://127.0.0.1:{port}/")
StudioServer(("127.0.0.1", port), handler).serve_forever()

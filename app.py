from __future__ import annotations

import csv
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
ANALYSIS_PATH = BASE_DIR / "analysis" / "model_similarity_scores.csv"
PORT = 8000


class VisualizerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def send_utf8_response(self, payload: str, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.end_headers()
        self.wfile.write(payload.encode("utf-8"))

    def send_json_response(self, payload: object) -> None:
        self.send_utf8_response(json.dumps(payload), "application/json")

    def resolve_model_path(self, requested_path: str) -> Path:
        candidate = (BASE_DIR / requested_path).resolve()
        if BASE_DIR != candidate and BASE_DIR not in candidate.parents:
            raise ValueError("Requested path must stay inside the workspace.")
        if candidate.is_dir() or not candidate.exists():
            raise ValueError("Requested model file was not found.")
        if candidate.suffix.lower() not in {".sysml", ".txt", ""}:
            raise ValueError("Only SysML2 text files are supported.")
        return candidate

    def resolve_write_path(self, requested_path: str) -> Path:
        if not requested_path.strip():
            raise ValueError("A workspace path is required to save the SysML file.")
        candidate = (BASE_DIR / requested_path).resolve()
        if BASE_DIR != candidate and BASE_DIR not in candidate.parents:
            raise ValueError("Save path must stay inside the workspace.")
        if candidate.exists() and candidate.is_dir():
            raise ValueError("Save path must point to a file, not a directory.")
        if candidate.suffix.lower() not in {".sysml", ".txt", ""}:
            raise ValueError("Only SysML2 text files can be saved.")
        if not candidate.parent.exists():
            raise ValueError("The destination folder does not exist.")
        return candidate

    def build_model_index(self) -> list[str]:
        files = {"sample_model.sysml"}
        files.update(
            str(path.relative_to(BASE_DIR))
            for path in DATA_DIR.rglob("*")
            if path.is_file() and path.suffix.lower() in {".sysml", ".txt"}
        )
        files.update(
            str(path.relative_to(BASE_DIR))
            for path in BASE_DIR.iterdir()
            if path.is_file() and path.name not in {"app.py", "README.md", "requirements.txt", ".DS_Store"}
            and path.suffix.lower() not in {".py", ".md", ".json", ".css", ".html"}
        )
        return sorted(files)

    def read_analysis_row(self, requested_path: str) -> dict[str, str] | None:
        if not ANALYSIS_PATH.exists():
            return None
        normalized = requested_path.lstrip("/")
        if normalized.endswith(".txt"):
            normalized = f"{Path(normalized).with_suffix('.sysml')}"
        with ANALYSIS_PATH.open("r", encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                if row.get("sysml_path") == normalized:
                    return row
        return None

    def build_analysis_payload(self, requested_path: str) -> dict[str, object]:
        normalized = requested_path.lstrip("/")
        score_row = self.read_analysis_row(normalized)
        intent_text = ""
        meta: dict[str, object] = {}

        try:
            source_path = self.resolve_model_path(normalized)
        except ValueError:
            source_path = None

        if source_path:
            companion_txt = source_path.with_suffix(".txt")
            if companion_txt.exists() and companion_txt != source_path:
                intent_text = companion_txt.read_text(encoding="utf-8")
            meta_path = source_path.parent / "meta.json"
            if meta_path.exists():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))

        return {
            "requested_path": normalized,
            "score": score_row,
            "intent_text": intent_text,
            "meta": meta,
        }

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/model-text":
            requested_path = parse_qs(parsed.query).get("path", ["sample_model.sysml"])[0]
            model_path = self.resolve_model_path(requested_path)
            payload = model_path.read_text(encoding="utf-8")
            self.send_utf8_response(payload, "text/plain")
            return

        if parsed.path == "/model-index":
            self.send_json_response({"files": self.build_model_index()})
            return

        if parsed.path == "/model-analysis":
            requested_path = parse_qs(parsed.query).get("path", ["sample_model.sysml"])[0]
            self.send_json_response(self.build_analysis_payload(requested_path))
            return

        if parsed.path == "/":
            self.path = "/templates/index.html"

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path != "/save-model":
            self.send_error(404, "Not found")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))
            requested_path = str(payload.get("path", "")).strip()
            text = str(payload.get("text", ""))
            model_path = self.resolve_write_path(requested_path)
            model_path.write_text(text, encoding="utf-8")
            self.send_json_response(
                {
                    "saved": True,
                    "path": str(model_path.relative_to(BASE_DIR)),
                    "bytes_written": len(text.encode("utf-8")),
                }
            )
        except ValueError as error:
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"saved": False, "error": str(error)}).encode("utf-8"))
        except json.JSONDecodeError:
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"saved": False, "error": "Invalid JSON payload."}).encode("utf-8"))
        except OSError as error:
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"saved": False, "error": str(error)}).encode("utf-8"))


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), VisualizerHandler)
    print(f"Serving SysML2 visualizer at http://127.0.0.1:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()

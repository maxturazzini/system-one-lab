"""Sidecar SemIf del lab: tiene in memoria un modello e lo interroga con il codice di SemIf.

Il lab non riscrive niente della tecnica. Prompt, tokenizzazione, verifica degli slot di
risposta e lettura dei logit sono quelli di `semif_phase1` (github.com/TheoLeeCJ/SemIf-OpenJev),
backend llama.cpp, la stessa strada di `semif-score --mode direct --backend llamacpp`.
Questo file fa solo tre cose: scarica il GGUF fissato, carica il modello una volta, e
risponde in HTTP su 127.0.0.1 al server Node del lab.

Avvio manuale (di solito lo avvia `npm start`):
    ~/.venvs/semif/bin/python semif/server.py --port 4318
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Gli stessi checkpoint della demo browser di SemIf, fissati alla stessa revisione
# (manifests/models.json). Il tokenizer di riferimento costruisce il prompt, il GGUF
# esegue il passaggio in avanti: è la coppia che SemIf verifica token per token.
MODELS = {
    "qwen3-0.6b": {
        "name": "Qwen3 0.6B",
        "size": "639 MB",
        "reference": ("Qwen/Qwen3-0.6B", "c1899de289a04d12100db370d81485cdf75e47ca"),
        "gguf": ("Qwen/Qwen3-0.6B-GGUF", "23749fefcc72300e3a2ad315e1317431b06b590a",
                 "Qwen3-0.6B-Q8_0.gguf", 639446688),
    },
    "minicpm5-2b": {
        "name": "MiniCPM5 2B",
        "size": "1,56 GB",
        "reference": ("openbmb/MiniCPM5-2B", "12a3808a956f869c767195e9266b59c4d21d92e2"),
        "gguf": ("openbmb/MiniCPM5-2B-GGUF", "2079a22f3beaa4e306449978533478fe0522f4b3",
                 "MiniCPM5-2B-Q4_K_M.gguf", 1561318368),
    },
    "qwen3.5-4b": {
        "name": "Qwen3.5 4B",
        "size": "3,01 GB",
        "reference": ("Qwen/Qwen3.5-4B", "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a"),
        "gguf": ("bartowski/Qwen_Qwen3.5-4B-GGUF", "4168f45a16a1290d65a4ec0fa312ae917a4c15d6",
                 "Qwen_Qwen3.5-4B-Q4_K_M.gguf", 3013027808),
    },
}
DEFAULT_MODEL = "minicpm5-2b"
# Stesso default di semif-score: niente troncamento, il prompt oltre il limite viene rifiutato.
MAX_TOKENS = 4096
CACHE_DIR = Path(os.environ.get("SEMIF_CACHE_DIR", Path.home() / ".cache" / "jev-lab" / "semif"))
MAX_BODY_BYTES = 2_000_000

try:
    from semif_phase1 import llamacpp_backend
    from semif_phase1.core import LETTERS, validate_row
    IMPORT_ERROR = None
except Exception as error:  # SemIf non installato nel Python che esegue il sidecar
    llamacpp_backend = None
    LETTERS = ""
    validate_row = None
    IMPORT_ERROR = f"{type(error).__name__}: {error}"


class Engine:
    """Un solo modello caricato alla volta; le valutazioni passano una per volta."""

    def __init__(self, mode: str, threads: int | None):
        self.mode = mode
        self.threads = threads
        self.status_lock = threading.Lock()
        self.score_lock = threading.Lock()
        self.status = {"phase": "idle", "model": None, "loaded": 0, "total": 0, "error": None}
        self.backend = None
        self.tokenizer = None
        self.metadata = None
        self.serial = None
        self.loader = None

    def snapshot(self) -> dict:
        with self.status_lock:
            return dict(self.status)

    def set_status(self, **changes) -> None:
        with self.status_lock:
            self.status.update(changes)

    def start_load(self, model_id: str) -> None:
        if IMPORT_ERROR:
            raise RuntimeError(f"SemIf non è installato nel Python del sidecar ({IMPORT_ERROR}).")
        if model_id not in MODELS:
            raise ValueError("Modello SemIf sconosciuto.")
        current = self.snapshot()
        if current["phase"] in {"downloading", "loading"}:
            raise RuntimeError("Un caricamento è già in corso.")
        if current["phase"] == "ready" and current["model"] == model_id:
            return
        self.set_status(phase="downloading", model=model_id, loaded=0, total=MODELS[model_id]["gguf"][3], error=None)
        self.loader = threading.Thread(target=self._load, args=(model_id,), daemon=True)
        self.loader.start()

    def _load(self, model_id: str) -> None:
        started = time.perf_counter()
        try:
            path = self._download(model_id)
            self.set_status(phase="loading")
            with self.score_lock:
                if self.backend is not None:
                    self.backend.close()
                    self.backend = self.tokenizer = self.metadata = self.serial = None
                source, revision = MODELS[model_id]["reference"]
                backend, tokenizer, metadata = llamacpp_backend.load_model(
                    source, revision, path, threads=self.threads, context_tokens=MAX_TOKENS)
                self.backend, self.tokenizer, self.metadata = backend, tokenizer, metadata
                if self.mode == "serial":
                    self.serial = llamacpp_backend.SerialPrefixScorer(backend, tokenizer, metadata, MAX_TOKENS)
            self.set_status(phase="ready", load_seconds=round(time.perf_counter() - started, 2))
        except Exception as error:
            self.set_status(phase="error", error=f"{type(error).__name__}: {error}")

    def _download(self, model_id: str) -> Path:
        repo, revision, filename, size = MODELS[model_id]["gguf"]
        target = CACHE_DIR / repo.replace("/", "--") / revision / filename
        if target.is_file() and target.stat().st_size == size:
            self.set_status(loaded=size, total=size)
            return target
        import httpx

        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(target.suffix + ".part")
        url = f"https://huggingface.co/{repo}/resolve/{revision}/{filename}"
        loaded = 0
        with httpx.stream("GET", url, follow_redirects=True, timeout=60) as response:
            response.raise_for_status()
            with partial.open("wb") as destination:
                for chunk in response.iter_bytes(8 * 1024 * 1024):
                    destination.write(chunk)
                    loaded += len(chunk)
                    self.set_status(loaded=loaded)
        if partial.stat().st_size != size:
            partial.unlink(missing_ok=True)
            raise RuntimeError(f"Download incompleto di {filename}: attesi {size} byte.")
        partial.rename(target)
        return target

    def score(self, rows: list[dict]) -> list[dict]:
        with self.score_lock:
            if self.backend is None:
                raise RuntimeError("Caricate prima il modello SemIf.")
            results = []
            for row in rows:
                try:
                    validate_row(row)
                    if self.serial is not None:
                        results.append(self.serial.score(row))
                    else:
                        results.append(llamacpp_backend.score(
                            self.backend, self.tokenizer, row, self.metadata, MAX_TOKENS))
                except Exception as error:
                    results.append({"id": row.get("id"), "error": f"{type(error).__name__}: {error}"})
            return results


def make_handler(engine: Engine):
    class Handler(BaseHTTPRequestHandler):
        # Il lab non registra i body: niente log di accesso.
        def log_message(self, format, *args):  # noqa: A002
            return

        def reply(self, status: int, payload: dict) -> None:
            body = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def read_json(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY_BYTES:
                raise ValueError("Richiesta troppo grande.")
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):
            if self.path != "/status":
                self.reply(404, {"error": "Risorsa non trovata."})
                return
            self.reply(200, {
                "installed": IMPORT_ERROR is None,
                "importError": IMPORT_ERROR,
                "mode": engine.mode,
                "maxOptions": len(LETTERS),
                "maxTokens": MAX_TOKENS,
                "defaultModel": DEFAULT_MODEL,
                "models": {key: {"name": value["name"], "size": value["size"]} for key, value in MODELS.items()},
                "status": engine.snapshot(),
                "metadata": engine.metadata,
            })

        def do_POST(self):
            try:
                payload = self.read_json()
                if self.path == "/load":
                    engine.start_load(str(payload.get("modelId") or ""))
                    self.reply(202, {"status": engine.snapshot()})
                elif self.path == "/score":
                    rows = payload.get("rows")
                    if not isinstance(rows, list) or not rows:
                        raise ValueError("rows deve essere una lista non vuota.")
                    started = time.perf_counter()
                    results = engine.score(rows)
                    self.reply(200, {
                        "results": results,
                        "metadata": engine.metadata,
                        "mode": engine.mode,
                        "seconds": time.perf_counter() - started,
                    })
                else:
                    self.reply(404, {"error": "Risorsa non trovata."})
            except (ValueError, json.JSONDecodeError) as error:
                self.reply(400, {"error": str(error)})
            except Exception as error:
                self.reply(503, {"error": str(error)})

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4318)
    parser.add_argument("--mode", choices=("direct", "serial"), default="direct",
                        help="direct = una lettura completa per domanda, come semif-score --mode direct; "
                             "serial = lo state si legge una volta per record e si riusa, più veloce")
    parser.add_argument("--threads", type=int, help="Thread CPU per llama.cpp (default: tutti i core)")
    args = parser.parse_args()
    engine = Engine(args.mode, args.threads)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(engine))
    state = "pronto" if IMPORT_ERROR is None else f"SemIf non installato ({IMPORT_ERROR})"
    print(f"SemIf sidecar: http://{args.host}:{args.port} · modalità {args.mode} · {state}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

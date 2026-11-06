from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from faster_whisper import WhisperModel
from pathlib import Path
from urllib.parse import urlparse
import tempfile
import os

app = FastAPI(title="LocalMind AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

model = WhisperModel("small", device="cpu", compute_type="int8")
MAX_FILE_SIZE = 25 * 1024 * 1024
ALLOWED_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".webm", ".ogg", ".flac",
    ".aac", ".mp4", ".mov", ".mkv", ".mpeg", ".mpg",
}


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=300)
    max_results: int = Field(default=5, ge=1, le=10)


@app.get("/health")
def health():
    return {"status": "ok", "service": "LocalMind AI"}


@app.post("/search")
def search(request: SearchRequest):
    """Search public web pages. Requires pip install ddgs and internet access."""
    try:
        from ddgs import DDGS
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Web search is not installed. Run: pip install ddgs",
        )

    try:
        raw_results = DDGS(timeout=12).text(
            request.query,
            max_results=request.max_results,
        )
        results = []
        for item in raw_results or []:
            url = str(item.get("href") or item.get("url") or "")
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                continue
            results.append({
                "title": str(item.get("title") or "Untitled")[:300],
                "url": url,
                "snippet": str(item.get("body") or "")[:1000],
            })
        return {"query": request.query, "results": results}
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Web search failed: {error}",
        )


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    filename = file.filename or "recording.webm"
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file format. Upload an audio or video file.",
        )

    temp_path = None
    try:
        data = await file.read(MAX_FILE_SIZE + 1)
        if len(data) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File must be 25 MB or smaller.")
        if not data:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp:
            temp.write(data)
            temp_path = temp.name

        segments, info = model.transcribe(
            temp_path,
            beam_size=1,
            vad_filter=True,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return {"text": text, "language": info.language}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {error}")
    finally:
        await file.close()
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)

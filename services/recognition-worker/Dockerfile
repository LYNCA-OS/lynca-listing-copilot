FROM python:3.12.8-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 ca-certificates tesseract-ocr tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
RUN paddleocr install_hpi_deps cpu

# PaddleOCR 3.0.x pulls PaddleX code paths that still import older LangChain
# module locations. Newer LangChain split those symbols into langchain-core and
# langchain-text-splitters, so provide tiny compatibility shims inside the
# image instead of downgrading unrelated dependency versions at runtime.
RUN printf '%s\n' \
  'from pathlib import Path' \
  'import langchain' \
  'root = Path(langchain.__file__).resolve().parent' \
  'docstore_dir = root / "docstore"' \
  'docstore_dir.mkdir(exist_ok=True)' \
  '(docstore_dir / "__init__.py").write_text("", encoding="utf-8")' \
  '(docstore_dir / "document.py").write_text("from langchain_core.documents import Document\n", encoding="utf-8")' \
  '(root / "text_splitter.py").write_text("from langchain_text_splitters import RecursiveCharacterTextSplitter\n", encoding="utf-8")' \
  > /tmp/lynca_langchain_compat.py \
  && python /tmp/lynca_langchain_compat.py \
  && rm /tmp/lynca_langchain_compat.py

COPY app /app/app

# Bake the exact PaddleOCR field-verifier weights and HPI engines the runtime uses
# into the image layer. Without this, every cold Cloud Run instance re-downloads
# the models plus fonts from the upstream (Baidu) CDN on first use — 30-60s of
# blocking work during which the instance cannot answer health probes, so
# Cloud Run returns 503 and callers time out. We call the app's own preload so
# the baked models match _get_paddleocr_engine()'s selection exactly
# (PP-OCRv6 medium on CPU with HPI); the follow-up predict builds and caches the
# HPI engine. Everything
# lands in PADDLE_PDX_CACHE_HOME and is committed to the image.
ENV PADDLE_PDX_CACHE_HOME=/opt/paddlex \
    PADDLEOCR_ENABLE_HPI=true \
    PADDLEOCR_DETECTION_MODEL_NAME=PP-OCRv6_medium_det \
    PADDLEOCR_RECOGNITION_MODEL_NAME=PP-OCRv6_medium_rec \
    PADDLEOCR_CPU_THREADS=2
RUN python -c "import numpy as np; from app.pipelines.ocr_pipeline import preload_paddleocr_engine, _get_paddleocr_engine, _get_paddleocr_recognition_engine; blank = np.zeros((64, 256, 3), dtype='uint8'); status = preload_paddleocr_engine(); print('preload:', status); _get_paddleocr_engine().predict(blank); _get_paddleocr_recognition_engine().predict(input=blank, batch_size=1); print('bake predict ok')"

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3).read()"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8080 --workers ${WORKER_PROCESSES:-${PADDLEOCR_WORKER_PROCESSES:-1}} --timeout-keep-alive 5"]

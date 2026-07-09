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

# Bake the PaddleOCR field-verifier weights and fonts into the image layer.
# Without this, every cold Cloud Run instance re-downloads the PP-OCRv5 det/rec
# models plus fonts from the upstream (Baidu) CDN on first use — 30-60s of
# blocking work during which the instance cannot answer health probes, so
# Cloud Run returns 503 and callers time out. Constructing the engine pulls the
# models; a dummy predict pulls the fonts (simfang.ttf / PingFang). All of it
# lands in PADDLE_PDX_CACHE_HOME and is committed to the image.
ENV PADDLE_PDX_CACHE_HOME=/opt/paddlex
RUN python -c "import numpy as np; from paddleocr import PaddleOCR; ocr = PaddleOCR(lang='en', use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False); ocr.predict(np.zeros((64, 256, 3), dtype='uint8'))"

COPY app /app/app

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3).read()"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8080 --workers ${PADDLEOCR_WORKER_PROCESSES:-1} --timeout-keep-alive 5"]

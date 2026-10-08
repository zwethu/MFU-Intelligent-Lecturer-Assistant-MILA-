FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    UV_LINK_MODE=copy

COPY . .

# --frozen installs exactly what's in uv.lock — no dependency resolution at
# build time, which is what made plain `pip install .` backtrack through
# every released version of google-cloud-aiplatform/google-adk (unpinned in
# pyproject.toml) and risk blowing Cloud Build's timeout.
RUN uv sync --frozen --no-dev

EXPOSE 8080

CMD uv run uvicorn main:app --host 0.0.0.0 --port ${PORT}

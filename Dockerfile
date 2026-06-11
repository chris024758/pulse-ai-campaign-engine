# Stage 1: Build & install dependencies
FROM python:3.11-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Final Runtime
FROM python:3.11-slim AS runner

WORKDIR /app

# Copy installed libraries from builder stage
COPY --from=builder /root/.local /root/.local
COPY --from=builder /app /app

# Ensure local bin is in PATH
ENV PATH=/root/.local/bin:$PATH

# Copy project files
COPY . .

EXPOSE 8080

CMD uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8080}

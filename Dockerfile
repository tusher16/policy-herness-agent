# Python backend — stdlib only, no pip installs needed.
# Build:  docker build -t policypulse-backend .
# Run:    docker run -p 8000:8000 --env-file .env.local policypulse-backend
FROM python:3.11-slim

WORKDIR /app
COPY backend/ ./backend/

ENV PYTHONPATH=/app/backend \
    POLICYPULSE_HOST=0.0.0.0 \
    POLICYPULSE_PORT=8000 \
    POLICYPULSE_MEMORY_PATH=/data/.policypulse-memory.json \
    POLICYPULSE_SESSION_STORE_PATH=/data/.policy-pulse-store.json

# /data is mounted as a PersistentVolume in k3s for durable memory/session state.
VOLUME /data

EXPOSE 8000
CMD ["python3", "-m", "policypulse.server"]

#!/usr/bin/env bash
set -e

echo "Starting HistoCoin services..."
docker compose up -d --build

echo "Waiting for services to be ready..."
sleep 10

echo "Adding a test URL..."
# Note: The Met URL is already in sources.json, but this tests the endpoint
curl -X POST http://localhost:8000/urls \
     -H "Content-Type: application/json" \
     -d '{"name":"Test Source","base_url":"https://example.com","cc0":true}' || echo "Source might already exist"

echo "Triggering crawl..."
curl -X POST http://localhost:8000/crawl

echo "Waiting for crawl to complete (approx 15s)..."
sleep 15

echo "Checking artifacts..."
# If jq is not installed, just print the output
if command -v jq &> /dev/null; then
    curl -s http://localhost:8000/artifacts | jq .
else
    curl -s http://localhost:8000/artifacts
fi

echo "Verification complete."

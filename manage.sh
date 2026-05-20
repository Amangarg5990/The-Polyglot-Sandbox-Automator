#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# Configuration
SANDBOX_DIR="/tmp/sandbox"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color
YELLOW='\033[1;33m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Resolve GIT_SHA (default to latest if git fails or no commits)
get_git_sha() {
    git rev-parse --short HEAD 2>/dev/null || echo "latest"
}

command_setup() {
    log_info "Running setup checks..."
    
    # Check docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH."
        exit 1
    fi
    log_info "Docker is installed."

    # Check git
    if ! command -v git &> /dev/null; then
        log_error "Git is not installed or not in PATH."
        exit 1
    fi
    log_info "Git is installed."

    # Pull base images
    log_info "Pulling base Docker images..."
    docker pull python:3.12-slim
    docker pull node:20-alpine
    log_info "Base images successfully pulled."
    
    # Create local sandbox directory
    if [ ! -d "$SANDBOX_DIR" ]; then
        log_info "Creating sandbox directory at $SANDBOX_DIR..."
        mkdir -p "$SANDBOX_DIR"
        chmod 777 "$SANDBOX_DIR" || true
    fi
    log_info "Setup complete."
}

command_build() {
    GIT_SHA=$(get_git_sha)
    log_info "Building images with tag: ${GIT_SHA}..."

    # Build Python runner
    log_info "Building Python sandbox runner..."
    docker build -t "python-runner:${GIT_SHA}" -f containers/python/Dockerfile containers/python

    # Build NodeJS runner
    log_info "Building Node.js sandbox runner..."
    docker build -t "node-runner:${GIT_SHA}" -f containers/nodejs/Dockerfile containers/nodejs

    # Build API service
    log_info "Building TypeScript API service..."
    docker build -t "api:${GIT_SHA}" -f containers/api/Dockerfile .

    log_info "Build completed successfully."
}

command_clean() {
    log_info "Cleaning up execution stack..."
    
    # Bring down docker-compose if running
    if command -v docker-compose &> /dev/null; then
        docker-compose down -v || true
    else
        docker compose down -v || true
    fi

    # Clean sandbox files
    if [ -d "$SANDBOX_DIR" ]; then
        log_info "Removing temp files in $SANDBOX_DIR..."
        # Use a temporary docker container to avoid permission issues with files created by Docker users
        docker run --rm -v "$SANDBOX_DIR:/sandbox" alpine sh -c "rm -rf /sandbox/*" || rm -rf "$SANDBOX_DIR"/* || true
    fi
    log_info "Cleanup complete."
}

command_test() {
    GIT_SHA=$(get_git_sha)
    export GIT_SHA
    log_info "Starting stack with tag: ${GIT_SHA}..."

    # Ensure sandbox directory exists
    mkdir -p "$SANDBOX_DIR" && chmod 777 "$SANDBOX_DIR" || true

    # Run compose
    if command -v docker-compose &> /dev/null; then
        docker-compose up -d
    else
        docker compose up -d
    fi

    log_info "Waiting for API server to become healthy..."
    MAX_ATTEMPTS=20
    ATTEMPT=0
    HEALTH_URL="http://localhost:3000/health"
    
    while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
        STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" || echo "000")
        if [ "$STATUS_CODE" -eq 200 ]; then
            log_info "API Server is online!"
            break
        fi
        log_warn "API Server not ready (HTTP $STATUS_CODE). Retrying in 1s..."
        sleep 1
        ATTEMPT=$((ATTEMPT + 1))
    done

    if [ "$STATUS_CODE" -ne 200 ]; then
        log_error "API Server failed to start in time. Check logs."
        exit 1
    fi

    # Run tests
    log_info "Executing Python Hello World test..."
    PY_PAYLOAD='{"language":"python","code":"print(\"Hello World from Python!\")"}'
    PY_RESP=$(curl -s -X POST -H "Content-Type: application/json" -d "$PY_PAYLOAD" http://localhost:3000/execute)
    echo "Python Response: $PY_RESP"
    
    # Check status is 200 (validate through output)
    PY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$PY_PAYLOAD" http://localhost:3000/execute)
    if [ "$PY_STATUS" -eq 200 ] && echo "$PY_RESP" | grep -q "Hello World from Python"; then
        log_info "Python test: PASSED (HTTP 200)"
    else
        log_error "Python test: FAILED"
        exit 1
    fi

    log_info "Executing Javascript Hello World test..."
    JS_PAYLOAD='{"language":"javascript","code":"console.log(\"Hello World from Node!\")"}'
    JS_RESP=$(curl -s -X POST -H "Content-Type: application/json" -d "$JS_PAYLOAD" http://localhost:3000/execute)
    echo "Javascript Response: $JS_RESP"

    JS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$JS_PAYLOAD" http://localhost:3000/execute)
    if [ "$JS_STATUS" -eq 200 ] && echo "$JS_RESP" | grep -q "Hello World from Node"; then
        log_info "Node.js test: PASSED (HTTP 200)"
    else
        log_error "Node.js test: FAILED"
        exit 1
    fi

    log_info "All tests completed successfully!"
}

command_logs() {
    log_info "Tailing logs (Errors and Critical messages highlighted)..."
    # Highlight ERROR and CRITICAL in compose logs
    if command -v docker-compose &> /dev/null; then
        docker-compose logs -f | grep --color=always -E 'ERROR|CRITICAL|$'
    else
        docker compose logs -f | grep --color=always -E 'ERROR|CRITICAL|$'
    fi
}

# Main Command Router
case "$1" in
    setup)
        command_setup
        ;;
    build)
        command_build
        ;;
    clean)
        command_clean
        ;;
    test)
        command_test
        ;;
    logs)
        command_logs
        ;;
    *)
        echo "Usage: $0 {setup|build|clean|test|logs}"
        exit 1
        ;;
esac

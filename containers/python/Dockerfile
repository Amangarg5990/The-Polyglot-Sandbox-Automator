FROM python:3.12-slim

# Create a non-root user 'runner' to sandbox execution
RUN adduser --disabled-password --gecos "" runner

# Set working directory
WORKDIR /app

# Switch to the non-root user
USER runner

# Run interactive python shell by default
CMD ["python3"]

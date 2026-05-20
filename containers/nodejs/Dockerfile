FROM node:20-alpine

# Create a non-root user 'runner' to sandbox execution
RUN adduser -D runner

# Set working directory
WORKDIR /app

# Switch to the non-root user
USER runner

# Run interactive node shell by default
CMD ["node"]

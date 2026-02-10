#!/bin/bash

# Agent Module Setup Script
# This script installs required dependencies for the agent module

echo "🤖 Setting up Agent Module dependencies..."
echo ""

# Install required NPM packages
echo "📦 Installing langchain and zod..."
npm install langchain zod

# Check if installation was successful
if [ $? -eq 0 ]; then
  echo "✅ Dependencies installed successfully!"
  echo ""
  echo "📝 Next steps:"
  echo "1. Copy .env.example to .env if you haven't already:"
  echo "   cp .env.example .env"
  echo ""
  echo "2. Update your .env file with:"
  echo "   DESIGN_SERVICE_URL=http://localhost:3000"
  echo "   OLLAMA_HOST=http://your-ubuntu-server:11434"
  echo "   OLLAMA_MODEL=mistral-nemo:latest"
  echo ""
  echo "3. Ensure design-service is running"
  echo ""
  echo "4. Start the service:"
  echo "   npm run start:dev"
  echo ""
  echo "5. Test the agent endpoint:"
  echo "   curl -X POST http://localhost:3001/agent/generate-design \\"
  echo "     -H 'Content-Type: application/json' \\"
  echo "     -d '{\"query\":\"Design a REST API with PostgreSQL database\"}'"
  echo ""
  echo "📚 For more information, see:"
  echo "   - AGENT_ARCHITECTURE.md (detailed architecture)"
  echo "   - AGENT_QUICKSTART.md (quick start guide)"
  echo ""
else
  echo "❌ Failed to install dependencies"
  echo "Please run 'npm install langchain zod' manually"
  exit 1
fi

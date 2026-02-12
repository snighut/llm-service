#!/bin/bash

# Setup script to configure GPT-4o-mini in Kubernetes
# Run this script to switch from Ollama to OpenAI

set -e

echo "============================================"
echo "GPT-4o-mini Setup for llm-service"
echo "============================================"
echo ""

# Check if OpenAI API key is provided
if [ -z "$OPENAI_API_KEY" ]; then
  echo "❌ Error: OPENAI_API_KEY environment variable not set"
  echo ""
  echo "Please set it before running this script:"
  echo "  export OPENAI_API_KEY=sk-your-key-here"
  echo ""
  exit 1
fi

echo "✅ Found OpenAI API key"
echo ""

# Update ConfigMap for LLM provider
echo "📝 Updating ConfigMap 'ai-config' to use OpenAI..."
kubectl patch configmap ai-config -n production --type merge -p '{"data":{"LLM_PROVIDER":"openai","OPENAI_MODEL":"gpt-4o-mini"}}'

# Check if secret exists
if kubectl get secret llm-service-secrets -n production &> /dev/null; then
  echo "📝 Updating existing secret 'llm-service-secrets'..."
  kubectl patch secret llm-service-secrets -n production --type merge -p "{\"stringData\":{\"OPENAI_API_KEY\":\"$OPENAI_API_KEY\"}}"
else
  echo "📝 Creating new secret 'llm-service-secrets'..."
  kubectl create secret generic llm-service-secrets -n production \
    --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" \
    --from-literal=JWT_SECRET="$(kubectl get secret llm-service-secrets -n production -o jsonpath='{.data.JWT_SECRET}' 2>/dev/null | base64 -d || echo 'your-super-secret-jwt-key-change-this-in-production')"
fi

echo ""
echo "🔄 Restarting llm-service deployment..."
kubectl rollout restart deployment llm-service -n production

echo ""
echo "⏳ Waiting for deployment to complete..."
kubectl rollout status deployment llm-service -n production --timeout=5m

echo ""
echo "✅ Setup complete!"
echo ""
echo "📊 Check logs with:"
echo "   kubectl logs -f deployment/llm-service -n production"
echo ""
echo "🔍 Verify the model with:"
echo "   kubectl logs deployment/llm-service -n production | grep 'Agent initialized'"
echo ""

#!/bin/bash
# Regenerate Flutter SDK from the live OpenAPI spec
# Usage: ./scripts/generate-flutter-sdk.sh [spec-url]
# Default spec URL points to production; use localhost for pre-deploy testing

set -euo pipefail

SPEC_URL="${1:-https://price-feed.bithub.pro/openapi.json}"
OUTPUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/price-feed-gateway-flutter"

echo "=== Regenerating Flutter SDK ==="
echo "  Spec URL: $SPEC_URL"
echo "  Output:   $OUTPUT_DIR"
echo ""

# Check required tools
if ! command -v openapi-generator &> /dev/null; then
  echo "Error: openapi-generator not found. Install it via:"
  echo "  brew install openapi-generator"
  exit 1
fi

# Remove old SDK
rm -rf "$OUTPUT_DIR"

# Generate new SDK
openapi-generator generate \
  -i "$SPEC_URL" \
  -g dart \
  -o "$OUTPUT_DIR" \
  --additional-properties=\
pubName=price_feed_gateway,\
pubVersion=0.1.0,\
pubDescription="ZeroWallet Price Feed Gateway API client for Flutter",\
useJsonKey=true,\
sortParamsByRequiredFlag=true

echo ""
echo "=== Done ==="
echo "Generated $(find "$OUTPUT_DIR/lib" -name '*.dart' | wc -l | xargs) Dart files"
echo "Generated $(find "$OUTPUT_DIR/test" -name '*.dart' | wc -l | xargs) test files"
echo "Generated $(find "$OUTPUT_DIR/doc" -name '*.md' | wc -l | xargs) doc files"

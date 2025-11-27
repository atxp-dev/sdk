#!/bin/bash
# Test script for MCP Apps UI support
# Run: ./test-mcp-ui.sh
# Requires: The MCP server running on localhost:3009

BASE_URL="http://localhost:3009/"

# MCP StreamableHTTP requires Accept header for both JSON and SSE
ACCEPT_HEADER="Accept: application/json, text/event-stream"

echo "=== Testing MCP Apps UI Support ==="
echo ""

# 1. List tools - should show secure-data with _meta containing ui/resourceUri
echo "1. Listing tools (checking for _meta.ui/resourceUri)..."
echo ""
TOOLS_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "$ACCEPT_HEADER" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }')

echo "Response:"
echo "$TOOLS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$TOOLS_RESPONSE"
echo ""

# Check if _meta exists
if echo "$TOOLS_RESPONSE" | grep -q "ui/resourceUri"; then
  echo "✅ Tool has ui/resourceUri in _meta"
else
  echo "❌ Tool missing ui/resourceUri in _meta"
fi
echo ""

# 2. List resources - should show ui://secure-data
echo "2. Listing resources..."
echo ""
RESOURCES_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "$ACCEPT_HEADER" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "resources/list",
    "params": {}
  }')

echo "Response:"
echo "$RESOURCES_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESOURCES_RESPONSE"
echo ""

# Check if resource exists
if echo "$RESOURCES_RESPONSE" | grep -q "ui://secure-data"; then
  echo "✅ UI resource ui://secure-data found"
else
  echo "❌ UI resource ui://secure-data not found"
fi
echo ""

# 3. Read the UI resource - should return HTML
echo "3. Reading UI resource (ui://secure-data)..."
echo ""
READ_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "$ACCEPT_HEADER" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "resources/read",
    "params": {
      "uri": "ui://secure-data"
    }
  }')

echo "Response (truncated):"
# Show first 500 chars of the response
echo "$READ_RESPONSE" | python3 -m json.tool 2>/dev/null | head -50 || echo "$READ_RESPONSE" | head -c 500
echo ""
echo "..."
echo ""

# Check if HTML content exists
if echo "$READ_RESPONSE" | grep -q "text/html+mcp"; then
  echo "✅ Resource has correct mimeType: text/html+mcp"
else
  echo "❌ Resource missing correct mimeType"
fi

if echo "$READ_RESPONSE" | grep -q "<!DOCTYPE html>"; then
  echo "✅ Resource contains HTML content"
else
  echo "❌ Resource missing HTML content"
fi
echo ""

echo "=== Test Complete ==="

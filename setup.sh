#!/bin/bash
set -e

SERVICE="hubthe-mcp"

echo "=== HubThe MCP — Настройка учётных данных ==="
echo "Credentials будут сохранены в macOS Keychain."
echo ""

read -p "Email: " email
read -s -p "Password: " password
echo ""

security delete-generic-password -s "$SERVICE" -a "email" 2>/dev/null || true
security delete-generic-password -s "$SERVICE" -a "password" 2>/dev/null || true

security add-generic-password -s "$SERVICE" -a "email" -w "$email"
security add-generic-password -s "$SERVICE" -a "password" -w "$password"

echo ""
echo "Credentials сохранены в Keychain (service: $SERVICE)."
echo "Перезагрузите Cursor для применения."

#!/bin/bash

# Obie Jukebox v2 - Quick Setup Script
# This script helps you get started quickly

set -e

echo "🎵 Obie Jukebox v2 - Quick Setup"
echo "================================"
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+ first."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install npm first."
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo "⚠️  Docker not found. Supabase local development requires Docker."
    echo "   You can still use Supabase Cloud. Continue? (y/n)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "✅ Prerequisites OK"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

echo "✅ Dependencies installed"
echo ""

# Setup environment files
echo "⚙️  Setting up environment files..."

if [ ! -f "web/admin/.env" ]; then
    cat > web/admin/.env << EOF
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
EOF
    echo "✅ Created web/admin/.env"
fi

if [ ! -f "web/player/.env" ]; then
    cat > web/player/.env << EOF
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
EOF
    echo "✅ Created web/player/.env"
fi

if [ ! -f "web/kiosk/.env" ]; then
    cat > web/kiosk/.env << EOF
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
EOF
    echo "✅ Created web/kiosk/.env"
fi

echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "⚠️  Supabase CLI not found. Installing..."
    npm install -g supabase
    echo "✅ Supabase CLI installed"
else
    echo "✅ Supabase CLI already installed"
fi

echo ""

# Ask user if they want to start Supabase locally
if command -v docker &> /dev/null; then
    echo "Do you want to start Supabase locally? (y/n)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo "🚀 Starting Supabase..."
        npm run supabase:start
        echo ""
        echo "✅ Supabase is running!"
        echo ""
        echo "📝 Supabase credentials (saved above):"
        echo "   - API URL: http://localhost:54321"
        echo "   - Studio: http://localhost:54323"
        echo ""
    fi
fi

echo "================================"
echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo ""
echo "1. Start all frontend apps:"
echo "   npm run dev"
echo ""
echo "2. Open in your browser:"
echo "   - Admin:  http://localhost:5173"
echo "   - Player: http://localhost:5174"
echo "   - Kiosk:  http://localhost:5175"
echo ""
echo "3. Make sure Player is running before using Admin or Kiosk"
echo ""
echo "📚 For more info, see:"
echo "   - README.md"
echo "   - DEVELOPMENT.md"
echo "   - DEPLOYMENT.md"
echo ""
echo "Happy jukeboxing! 🎵"

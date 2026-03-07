#!/usr/bin/env node
/**
 * MCP Audio Console Server
 *
 * A Model Context Protocol server for professional digital audio console control.
 * Provides tools for mixing live sound like a professional FOH engineer.
 *
 * Supported consoles:
 *   - Behringer X32 / Midas M32 (OSC protocol)
 *
 * Usage:
 *   npx mcp-audio-console                    # stdio transport (default)
 *   npx mcp-audio-console --host 192.168.1.X # connect to console on startup
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type { ConsoleDriver } from './console/interface.js';
import { X32Driver } from './drivers/x32-driver.js';

import { registerChannelTools } from './tools/channel-tools.js';
import { registerEQTools } from './tools/eq-tools.js';
import { registerDynamicsTools } from './tools/dynamics-tools.js';
import { registerSendsTools } from './tools/sends-tools.js';
import { registerMixingTools } from './tools/mixing-tools.js';

import {
  MIXING_GUIDELINES,
  EQ_PRESETS,
  DYNAMICS_PRESETS,
  EFFECT_PRESETS,
  CHANNEL_LAYOUTS,
} from './mixing/knowledge.js';

// ── State ──────────────────────────────────────────────────────

let driver: ConsoleDriver | null = null;

function getDriver(): ConsoleDriver {
  if (!driver) {
    throw new Error(
      'No console connected. Use the "connect_console" tool first to connect to a digital audio console.'
    );
  }
  return driver;
}

// ── Server Setup ───────────────────────────────────────────────

const server = new McpServer({
  name: 'mcp-audio-console',
  version: '0.1.0',
  description: 'Professional digital audio console control via MCP. Mix live sound like a FOH engineer.',
});

// ── Connection Tool ────────────────────────────────────────────

server.tool(
  'connect_console',
  'Connect to a digital audio console. Currently supports Behringer X32 and Midas M32 via OSC.',
  {
    host: z.string().describe('Console IP address (e.g., "192.168.1.100")'),
    port: z.number().int().default(10023).describe('Console OSC port (default: 10023 for X32)'),
    model: z.enum(['x32', 'm32']).default('x32').describe('Console model'),
  },
  async ({ host, port, model }: { host: string; port: number; model: string }) => {
    // Disconnect existing connection
    if (driver) {
      await driver.disconnect();
    }

    driver = new X32Driver();
    await driver.connect({ host, port });

    const caps = driver.getCapabilities();
    return {
      content: [{
        type: 'text' as const,
        text: `Connected to ${caps.manufacturer} ${caps.model} at ${host}:${port}\n` +
          `Channels: ${caps.input_channels} inputs, ${caps.mix_buses} buses, ` +
          `${caps.dcas} DCAs, ${caps.fx_slots} FX slots`,
      }],
    };
  }
);

server.tool(
  'disconnect_console',
  'Disconnect from the currently connected console.',
  {},
  async () => {
    if (driver) {
      await driver.disconnect();
      driver = null;
    }
    return { content: [{ type: 'text' as const, text: 'Disconnected from console.' }] };
  }
);

// ── Register All Tool Groups ───────────────────────────────────

registerChannelTools(server, getDriver);
registerEQTools(server, getDriver);
registerDynamicsTools(server, getDriver);
registerSendsTools(server, getDriver);
registerMixingTools(server, getDriver);

// ── MCP Resources (Knowledge Base) ─────────────────────────────

server.resource(
  'mixing-guidelines',
  'knowledge://mixing-guidelines',
  {
    description: 'Professional FOH mixing guidelines and best practices',
    mimeType: 'application/json',
  },
  async () => ({
    contents: [{
      uri: 'knowledge://mixing-guidelines',
      text: JSON.stringify(MIXING_GUIDELINES, null, 2),
      mimeType: 'application/json',
    }],
  })
);

server.resource(
  'eq-presets',
  'knowledge://eq-presets',
  {
    description: 'Professional EQ starting points for common instruments',
    mimeType: 'application/json',
  },
  async () => ({
    contents: [{
      uri: 'knowledge://eq-presets',
      text: JSON.stringify(EQ_PRESETS, null, 2),
      mimeType: 'application/json',
    }],
  })
);

server.resource(
  'dynamics-presets',
  'knowledge://dynamics-presets',
  {
    description: 'Professional dynamics processing presets (gates, compressors)',
    mimeType: 'application/json',
  },
  async () => ({
    contents: [{
      uri: 'knowledge://dynamics-presets',
      text: JSON.stringify(DYNAMICS_PRESETS, null, 2),
      mimeType: 'application/json',
    }],
  })
);

server.resource(
  'effects-presets',
  'knowledge://effects-presets',
  {
    description: 'Professional effects presets (reverbs, delays)',
    mimeType: 'application/json',
  },
  async () => ({
    contents: [{
      uri: 'knowledge://effects-presets',
      text: JSON.stringify(EFFECT_PRESETS, null, 2),
      mimeType: 'application/json',
    }],
  })
);

server.resource(
  'channel-layouts',
  'knowledge://channel-layouts',
  {
    description: 'Channel layout templates for common show types',
    mimeType: 'application/json',
  },
  async () => ({
    contents: [{
      uri: 'knowledge://channel-layouts',
      text: JSON.stringify(CHANNEL_LAYOUTS, null, 2),
      mimeType: 'application/json',
    }],
  })
);

server.resource(
  'frequency-guide',
  'knowledge://frequency-guide',
  {
    description: 'Audio frequency range guide for mixing decisions',
    mimeType: 'application/json',
  },
  async () => ({
    contents: [{
      uri: 'knowledge://frequency-guide',
      text: JSON.stringify(MIXING_GUIDELINES.frequency_ranges, null, 2),
      mimeType: 'application/json',
    }],
  })
);

// ── MCP Prompts (Mixing Scenarios) ─────────────────────────────

server.prompt(
  'soundcheck',
  'Walk through a professional soundcheck procedure step by step.',
  {
    band_type: z.string().optional().describe('Type of band/act (e.g., "rock band", "worship", "acoustic duo")'),
  },
  ({ band_type }: { band_type?: string }) => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `You are a professional FOH (Front of House) live sound engineer conducting a soundcheck${band_type ? ` for a ${band_type}` : ''}. Walk through the complete soundcheck procedure:

1. LINE CHECK: Verify every channel has signal. Go through each input one at a time.
2. GAIN STAGING: Set preamp gains with each source at performance level. Peaks around -18dBFS.
3. HIGH-PASS FILTERS: Set HPF on every channel that doesn't need low end.
4. INDIVIDUAL CHANNEL EQ: Shape each source. Drums first (kick, snare, toms, overheads), then bass, guitars, keys, vocals.
5. DYNAMICS: Set gates on drums, compression on vocals and bass.
6. MONITOR MIXES: Work with performers on their monitor mixes (buses 1-6 typically).
7. EFFECTS: Set up reverbs and delays. Subtle is better for live sound.
8. BUILD THE MIX: Bring everything together. Check balance, stereo image, and overall level.
9. WALK THE ROOM: Check the mix from different positions in the venue.

Use the console tools to read current state and make adjustments. Explain your reasoning like an experienced engineer mentoring a new sound tech.`,
      },
    }],
  })
);

server.prompt(
  'mix-from-scratch',
  'Set up and mix a show from a blank console state.',
  {
    layout: z.string().optional().describe('Channel layout to use (rock-band-basic, worship-band)'),
    genre: z.string().optional().describe('Music genre for mixing style'),
  },
  ({ layout, genre }: { layout?: string; genre?: string }) => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `You are a professional FOH engineer setting up a show from scratch${genre ? ` for a ${genre} act` : ''}.

${layout ? `Use the "${layout}" channel layout template as a starting point.` : 'First, ask about the input list and choose an appropriate layout.'}

Walk through the full setup:
1. Apply channel layout (names, routing)
2. Set initial EQ and dynamics from professional presets
3. Configure effects (reverbs, delays)
4. Set up DCA groups for mix management
5. Build initial fader positions for a balanced starting mix

Use console tools to make all changes. Explain your mixing decisions and the reasoning behind EQ curves, compression settings, and effects choices. Reference frequency ranges and best practices from the knowledge base.`,
      },
    }],
  })
);

server.prompt(
  'troubleshoot',
  'Diagnose and fix a live sound problem.',
  {
    problem: z.string().describe('Description of the problem (e.g., "vocals are muddy", "feedback on channel 5", "mix sounds thin")'),
  },
  ({ problem }: { problem: string }) => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `You are an experienced FOH engineer troubleshooting a live sound problem.

Problem reported: "${problem}"

Systematic approach:
1. READ the current console state (relevant channels, EQ, dynamics, sends)
2. DIAGNOSE the likely cause based on the settings and your experience
3. RECOMMEND specific changes with explanations
4. APPLY the changes using console tools
5. EXPLAIN what you changed and why, so the operator learns

Use get_mix_overview first to understand the current state, then drill into specific channels. Reference the mixing guidelines knowledge base for best practices.`,
      },
    }],
  })
);

// ── Start Server ───────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const hostIdx = args.indexOf('--host');
  const autoConnectHost = hostIdx >= 0 ? args[hostIdx + 1] : undefined;

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Auto-connect if --host provided
  if (autoConnectHost) {
    driver = new X32Driver();
    await driver.connect({ host: autoConnectHost, port: 10023 });
    console.error(`Auto-connected to X32 at ${autoConnectHost}:10023`);
  }

  console.error('MCP Audio Console Server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

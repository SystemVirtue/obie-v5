# MCP Audio Console Server

A Model Context Protocol (MCP) server for professional digital audio console control. Enables AI-assisted live sound mixing with the knowledge of an experienced Front-of-House engineer.

## Supported Consoles

- **Behringer X32 / Midas M32** — via OSC protocol over UDP
- Architecture supports adding drivers for Yamaha, Allen & Heath, etc.

## Features

### MCP Tools (30+)

**Channel Control**
- `connect_console` / `disconnect_console` — manage console connection
- `get_channel` / `get_all_channels` — read channel state
- `set_fader` / `set_mute` / `set_pan` — basic channel control
- `set_channel_name` — scribble strip naming
- `set_preamp` — gain, phantom power, phase, HPF

**EQ**
- `get_eq` / `set_eq_band` / `set_eq_enabled` — parametric EQ control
- `apply_eq_preset` — professional EQ starting points per instrument

**Dynamics**
- `get_dynamics` / `set_gate` / `set_compressor` — dynamics processing
- `apply_dynamics_preset` — professional gate/comp presets

**Routing & Effects**
- `get_sends` / `set_send` — aux/bus sends (monitor mixes)
- `get_effects` / `set_effect` — effects processors
- `set_dca` — DCA/VCA group control
- `set_mute_group` — mute group control
- `recall_scene` / `list_scenes` — scene management

**Mixing Intelligence**
- `get_mix_overview` — full console state at a glance
- `get_mixing_guidelines` — professional best practices
- `diagnose_mix_problem` — troubleshoot common issues
- `apply_channel_layout` — set up entire shows from templates
- `list_presets` — browse all available presets
- `get_meters` — signal level monitoring

### MCP Resources
- `knowledge://mixing-guidelines` — FOH mixing philosophy and best practices
- `knowledge://eq-presets` — EQ starting points for every instrument
- `knowledge://dynamics-presets` — Gate and compressor presets
- `knowledge://effects-presets` — Reverb and delay presets
- `knowledge://channel-layouts` — Full show layout templates
- `knowledge://frequency-guide` — Audio frequency range reference

### MCP Prompts
- `soundcheck` — guided professional soundcheck procedure
- `mix-from-scratch` — set up and mix a show from blank console
- `troubleshoot` — diagnose and fix live sound problems

## Quick Start

```bash
cd mcp-audio-console
npm install
npm run build
```

### Add to Claude Desktop

```json
{
  "mcpServers": {
    "audio-console": {
      "command": "node",
      "args": ["path/to/mcp-audio-console/dist/index.js"]
    }
  }
}
```

### Auto-connect to console

```json
{
  "mcpServers": {
    "audio-console": {
      "command": "node",
      "args": ["path/to/mcp-audio-console/dist/index.js", "--host", "192.168.1.100"]
    }
  }
}
```

## Architecture

```
src/
├── console/
│   ├── types.ts          # Protocol-agnostic audio console types
│   └── interface.ts      # ConsoleDriver interface (implement per console)
├── drivers/
│   ├── x32-driver.ts     # Behringer X32/Midas M32 OSC driver
│   ├── x32-osc-mappings.ts  # X32 OSC addresses & value conversions
│   └── node-osc.d.ts     # Type declarations for node-osc
├── mixing/
│   └── knowledge.ts      # Professional FOH mixing knowledge base
├── tools/
│   ├── channel-tools.ts  # Channel fader/mute/pan/preamp tools
│   ├── eq-tools.ts       # EQ control tools
│   ├── dynamics-tools.ts # Gate/compressor tools
│   ├── sends-tools.ts    # Bus sends, effects, DCA, scenes
│   └── mixing-tools.ts   # High-level mixing intelligence tools
└── index.ts              # MCP server entry point
```

## Adding Console Support

Implement the `ConsoleDriver` interface in `src/console/interface.ts` for your console's protocol:

```typescript
import type { ConsoleDriver } from './console/interface.js';

export class YamahaQLDriver implements ConsoleDriver {
  // Implement all methods...
}
```

## License

MIT

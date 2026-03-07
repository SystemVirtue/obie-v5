/**
 * MCP tools for dynamics processing — gates and compressors.
 */

import { z } from 'zod';
import type { ConsoleDriver } from '../console/interface.js';
import type { ChannelType } from '../console/types.js';

const ChannelTypeSchema = z.enum(['input', 'aux', 'fx-return', 'bus', 'matrix', 'dca', 'main', 'monitor']);

export function registerDynamicsTools(server: any, getDriver: () => ConsoleDriver) {
  // ── Get Dynamics ────────────────────────────────────────
  server.tool(
    'get_dynamics',
    'Get the gate and compressor settings for a channel.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
    },
    async ({ channel_type, channel }: { channel_type: ChannelType; channel: number }) => {
      const driver = getDriver();
      const dynamics = await driver.getDynamics(channel_type, channel);
      return { content: [{ type: 'text' as const, text: JSON.stringify(dynamics, null, 2) }] };
    }
  );

  // ── Set Gate ────────────────────────────────────────────
  server.tool(
    'set_gate',
    'Configure the noise gate on a channel. Use for drums and noisy inputs.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
      enabled: z.boolean().optional().describe('Gate on/off'),
      threshold: z.number().min(-80).max(0).optional().describe('Gate threshold in dB'),
      range: z.number().min(0).max(80).optional().describe('Gate range/depth in dB'),
      attack: z.number().min(0).max(120).optional().describe('Attack time in ms'),
      hold: z.number().min(0).max(2000).optional().describe('Hold time in ms'),
      release: z.number().min(5).max(4000).optional().describe('Release time in ms'),
    },
    async ({ channel_type, channel, ...params }: { channel_type: ChannelType; channel: number; enabled?: boolean; threshold?: number; range?: number; attack?: number; hold?: number; release?: number }) => {
      const driver = getDriver();
      await driver.setGate(channel_type, channel, params);
      return { content: [{ type: 'text' as const, text: `Updated gate on ${channel_type} ${channel}: ${JSON.stringify(params)}` }] };
    }
  );

  // ── Set Compressor ──────────────────────────────────────
  server.tool(
    'set_compressor',
    'Configure the compressor on a channel. Controls dynamic range.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
      enabled: z.boolean().optional().describe('Compressor on/off'),
      threshold: z.number().min(-80).max(0).optional().describe('Threshold in dB'),
      ratio: z.number().min(1).max(100).optional().describe('Compression ratio (e.g., 4 = 4:1)'),
      attack: z.number().min(0).max(120).optional().describe('Attack time in ms'),
      hold: z.number().min(0).max(2000).optional().describe('Hold time in ms'),
      release: z.number().min(5).max(4000).optional().describe('Release time in ms'),
      knee: z.number().min(0).max(6).optional().describe('Knee in dB (0 = hard knee)'),
      makeup_gain: z.number().min(-15).max(15).optional().describe('Makeup gain in dB'),
      auto_gain: z.boolean().optional().describe('Auto makeup gain on/off'),
    },
    async ({ channel_type, channel, ...params }: { channel_type: ChannelType; channel: number; enabled?: boolean; threshold?: number; ratio?: number; attack?: number; hold?: number; release?: number; knee?: number; makeup_gain?: number; auto_gain?: boolean }) => {
      const driver = getDriver();
      await driver.setCompressor(channel_type, channel, params);
      return { content: [{ type: 'text' as const, text: `Updated compressor on ${channel_type} ${channel}: ${JSON.stringify(params)}` }] };
    }
  );

  // ── Apply Dynamics Preset ───────────────────────────────
  server.tool(
    'apply_dynamics_preset',
    'Apply a professional dynamics preset (gate + compressor). Available: vocal-gentle, vocal-aggressive, kick-gate, snare-gate, tom-gate, bass-comp, acoustic-guitar-comp, bus-glue.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
      preset: z.string().describe('Dynamics preset name'),
    },
    async ({ channel_type, channel, preset }: { channel_type: ChannelType; channel: number; preset: string }) => {
      const { DYNAMICS_PRESETS } = await import('../mixing/knowledge.js');
      const p = DYNAMICS_PRESETS[preset];
      if (!p) {
        return { content: [{ type: 'text' as const, text: `Unknown preset "${preset}". Available: ${Object.keys(DYNAMICS_PRESETS).join(', ')}` }], isError: true };
      }

      const driver = getDriver();

      if (p.gate) {
        await driver.setGate(channel_type, channel, { enabled: true, ...p.gate });
      }
      await driver.setCompressor(channel_type, channel, { enabled: true, ...p.compressor });

      return {
        content: [{
          type: 'text' as const,
          text: `Applied "${p.name}" dynamics preset to ${channel_type} ${channel}:\n${p.description}\n${p.gate ? `Gate: thr=${p.gate.threshold}dB range=${p.gate.range}dB atk=${p.gate.attack}ms rel=${p.gate.release}ms\n` : ''}Comp: thr=${p.compressor.threshold}dB ratio=${p.compressor.ratio}:1 atk=${p.compressor.attack}ms rel=${p.compressor.release}ms makeup=${p.compressor.makeup_gain}dB`,
        }],
      };
    }
  );
}

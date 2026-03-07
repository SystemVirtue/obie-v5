/**
 * MCP tools for EQ operations.
 */

import { z } from 'zod';
import type { ConsoleDriver } from '../console/interface.js';
import type { ChannelType } from '../console/types.js';

const ChannelTypeSchema = z.enum(['input', 'aux', 'fx-return', 'bus', 'matrix', 'dca', 'main', 'monitor']);

export function registerEQTools(server: any, getDriver: () => ConsoleDriver) {
  // ── Get EQ State ────────────────────────────────────────
  server.tool(
    'get_eq',
    'Get the current EQ settings for a channel, including all band frequencies, gains, and Q values.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
    },
    async ({ channel_type, channel }: { channel_type: ChannelType; channel: number }) => {
      const driver = getDriver();
      const eq = await driver.getEQ(channel_type, channel);
      return { content: [{ type: 'text' as const, text: JSON.stringify(eq, null, 2) }] };
    }
  );

  // ── Set EQ Band ─────────────────────────────────────────
  server.tool(
    'set_eq_band',
    'Set EQ parameters for a specific band. Frequency in Hz, gain in dB, Q for bandwidth.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
      band: z.number().int().min(1).max(6).describe('EQ band number (1=low, 2=low-mid, 3=high-mid, 4=high)'),
      frequency: z.number().min(20).max(20000).optional().describe('Center frequency in Hz'),
      gain: z.number().min(-15).max(15).optional().describe('Gain in dB (-15 to +15)'),
      q: z.number().min(0.3).max(16).optional().describe('Q factor / bandwidth (0.3 = wide, 16 = narrow)'),
    },
    async ({ channel_type, channel, band, ...params }: { channel_type: ChannelType; channel: number; band: number; frequency?: number; gain?: number; q?: number }) => {
      const driver = getDriver();
      await driver.setEQBand(channel_type, channel, band, params);
      const changes = Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return { content: [{ type: 'text' as const, text: `Set ${channel_type} ${channel} EQ band ${band}: ${changes}` }] };
    }
  );

  // ── Enable/Disable EQ ──────────────────────────────────
  server.tool(
    'set_eq_enabled',
    'Enable or disable the EQ section on a channel.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
      enabled: z.boolean().describe('true = EQ on, false = EQ bypassed'),
    },
    async ({ channel_type, channel, enabled }: { channel_type: ChannelType; channel: number; enabled: boolean }) => {
      const driver = getDriver();
      await driver.setEQEnabled(channel_type, channel, enabled);
      return { content: [{ type: 'text' as const, text: `${enabled ? 'Enabled' : 'Disabled'} EQ on ${channel_type} ${channel}` }] };
    }
  );

  // ── Apply EQ Preset ─────────────────────────────────────
  server.tool(
    'apply_eq_preset',
    'Apply a professional EQ starting-point preset to a channel. Available presets: vocal-male, vocal-female, kick-drum, snare-drum, hi-hat, toms, overheads, bass-guitar-di, bass-guitar-amp, electric-guitar-clean, electric-guitar-distorted, acoustic-guitar, piano, trumpet, saxophone.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
      preset: z.string().describe('Preset name from the knowledge base'),
    },
    async ({ channel_type, channel, preset }: { channel_type: ChannelType; channel: number; preset: string }) => {
      const { EQ_PRESETS } = await import('../mixing/knowledge.js');
      const p = EQ_PRESETS[preset];
      if (!p) {
        return { content: [{ type: 'text' as const, text: `Unknown preset "${preset}". Available: ${Object.keys(EQ_PRESETS).join(', ')}` }], isError: true };
      }

      const driver = getDriver();

      // Apply HPF if applicable
      if (p.highpass && channel_type === 'input') {
        await driver.setPreamp(channel, { low_cut: true, low_cut_freq: p.highpass });
      }

      // Apply EQ bands
      await driver.setEQEnabled(channel_type, channel, true);
      for (let i = 0; i < p.bands.length; i++) {
        const band = p.bands[i];
        await driver.setEQBand(channel_type, channel, i + 1, {
          frequency: band.freq,
          gain: band.gain,
          q: band.q,
        });
      }

      const bandSummary = p.bands.map((b, i) => `  Band ${i + 1}: ${b.freq}Hz ${b.gain > 0 ? '+' : ''}${b.gain}dB Q${b.q} — ${b.note}`).join('\n');
      return {
        content: [{
          type: 'text' as const,
          text: `Applied "${p.name}" EQ preset to ${channel_type} ${channel}:\n${p.highpass ? `  HPF: ${p.highpass}Hz\n` : ''}${bandSummary}`,
        }],
      };
    }
  );
}

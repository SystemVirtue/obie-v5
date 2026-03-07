/**
 * MCP tools for channel operations — faders, mutes, panning, naming.
 */

import { z } from 'zod';
import type { ConsoleDriver } from '../console/interface.js';
import type { ChannelType } from '../console/types.js';

const ChannelTypeSchema = z.enum(['input', 'aux', 'fx-return', 'bus', 'matrix', 'dca', 'main', 'monitor']);

export function registerChannelTools(server: any, getDriver: () => ConsoleDriver) {
  // ── Get Channel State ───────────────────────────────────
  server.tool(
    'get_channel',
    'Get the full state of a channel including fader, EQ, dynamics, and sends',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number (1-based)'),
    },
    async ({ channel_type, channel }: { channel_type: ChannelType; channel: number }) => {
      const driver = getDriver();
      const state = await driver.getChannelState(channel_type, channel);
      return { content: [{ type: 'text' as const, text: JSON.stringify(state, null, 2) }] };
    }
  );

  // ── Get All Channels ────────────────────────────────────
  server.tool(
    'get_all_channels',
    'Get state of all channels of a given type (input, bus, etc.). Returns an overview for mixing decisions.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channels to list'),
    },
    async ({ channel_type }: { channel_type: ChannelType }) => {
      const driver = getDriver();
      const states = await driver.getAllChannelStates(channel_type);
      const summary = states.map(s => ({
        ch: s.config.index,
        name: s.config.name,
        level: `${s.fader.level_db.toFixed(1)} dB`,
        muted: s.fader.muted,
        pan: s.pan.position,
        eq_on: s.eq.enabled,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // ── Set Fader Level ─────────────────────────────────────
  server.tool(
    'set_fader',
    'Set the fader level of a channel in dB. Range: -90 (off) to +10. 0dB = unity.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
      level_db: z.number().min(-90).max(10).describe('Fader level in dB (-90 to +10, 0 = unity)'),
    },
    async ({ channel_type, channel, level_db }: { channel_type: ChannelType; channel: number; level_db: number }) => {
      const driver = getDriver();
      await driver.setFader(channel_type, channel, level_db);
      return { content: [{ type: 'text' as const, text: `Set ${channel_type} ${channel} fader to ${level_db} dB` }] };
    }
  );

  // ── Set Mute ────────────────────────────────────────────
  server.tool(
    'set_mute',
    'Mute or unmute a channel.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
      muted: z.boolean().describe('true = muted, false = unmuted'),
    },
    async ({ channel_type, channel, muted }: { channel_type: ChannelType; channel: number; muted: boolean }) => {
      const driver = getDriver();
      await driver.setMute(channel_type, channel, muted);
      return { content: [{ type: 'text' as const, text: `${muted ? 'Muted' : 'Unmuted'} ${channel_type} ${channel}` }] };
    }
  );

  // ── Set Pan ─────────────────────────────────────────────
  server.tool(
    'set_pan',
    'Set the stereo pan position of a channel. -100 = hard left, 0 = center, +100 = hard right.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
      position: z.number().min(-100).max(100).describe('Pan position (-100 left to +100 right)'),
    },
    async ({ channel_type, channel, position }: { channel_type: ChannelType; channel: number; position: number }) => {
      const driver = getDriver();
      await driver.setPan(channel_type, channel, position);
      return { content: [{ type: 'text' as const, text: `Set ${channel_type} ${channel} pan to ${position}` }] };
    }
  );

  // ── Set Channel Name ────────────────────────────────────
  server.tool(
    'set_channel_name',
    'Set the scribble-strip name of a channel.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
      name: z.string().max(12).describe('Channel name (max 12 chars for scribble strip)'),
    },
    async ({ channel_type, channel, name }: { channel_type: ChannelType; channel: number; name: string }) => {
      const driver = getDriver();
      await driver.setChannelConfig(channel_type, channel, { name });
      return { content: [{ type: 'text' as const, text: `Renamed ${channel_type} ${channel} to "${name}"` }] };
    }
  );

  // ── Set Preamp Gain ─────────────────────────────────────
  server.tool(
    'set_preamp',
    'Set preamp/gain settings for an input channel. Gain range: -12 to +60 dB.',
    {
      channel: z.number().int().min(1).max(32).describe('Input channel number'),
      gain_db: z.number().min(-12).max(60).optional().describe('Preamp gain in dB'),
      phantom: z.boolean().optional().describe('+48V phantom power'),
      phase_invert: z.boolean().optional().describe('Polarity invert'),
      low_cut: z.boolean().optional().describe('High-pass filter on/off'),
      low_cut_freq: z.number().min(20).max(400).optional().describe('High-pass filter frequency in Hz'),
    },
    async (params: { channel: number; gain_db?: number; phantom?: boolean; phase_invert?: boolean; low_cut?: boolean; low_cut_freq?: number }) => {
      const driver = getDriver();
      const { channel, ...preampParams } = params;
      await driver.setPreamp(channel, preampParams);
      return { content: [{ type: 'text' as const, text: `Updated preamp on channel ${channel}: ${JSON.stringify(preampParams)}` }] };
    }
  );
}

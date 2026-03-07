/**
 * MCP tools for aux sends, bus routing, and effects management.
 */

import { z } from 'zod';
import type { ConsoleDriver } from '../console/interface.js';
import type { ChannelType } from '../console/types.js';

const ChannelTypeSchema = z.enum(['input', 'aux', 'fx-return', 'bus', 'matrix', 'dca', 'main', 'monitor']);

export function registerSendsTools(server: any, getDriver: () => ConsoleDriver) {
  // ── Get Sends ───────────────────────────────────────────
  server.tool(
    'get_sends',
    'Get all bus send levels from a channel. Shows monitor/aux mix routing.',
    {
      channel_type: ChannelTypeSchema.describe('Type of channel'),
      channel: z.number().int().min(1).describe('Channel number'),
    },
    async ({ channel_type, channel }: { channel_type: ChannelType; channel: number }) => {
      const driver = getDriver();
      const sends = await driver.getSends(channel_type, channel);
      const active = sends.filter(s => s.level_db > -89);
      return { content: [{ type: 'text' as const, text: JSON.stringify(active, null, 2) }] };
    }
  );

  // ── Set Send Level ──────────────────────────────────────
  server.tool(
    'set_send',
    'Set the send level from a channel to a bus/aux. Used for monitor mixes and effects sends.',
    {
      channel_type: ChannelTypeSchema.describe('Source channel type'),
      channel: z.number().int().min(1).describe('Source channel number'),
      bus: z.number().int().min(1).max(16).describe('Destination bus number'),
      level_db: z.number().min(-90).max(10).optional().describe('Send level in dB'),
      enabled: z.boolean().optional().describe('Send on/off'),
      pan: z.number().min(-100).max(100).optional().describe('Send pan (-100 to +100)'),
      pre_fader: z.boolean().optional().describe('Pre-fader send (true for monitors)'),
    },
    async ({ channel_type, channel, bus, ...params }: { channel_type: ChannelType; channel: number; bus: number; level_db?: number; enabled?: boolean; pan?: number; pre_fader?: boolean }) => {
      const driver = getDriver();
      await driver.setSend(channel_type, channel, bus, { bus_index: bus, ...params } as any);
      return { content: [{ type: 'text' as const, text: `Set ${channel_type} ${channel} → bus ${bus}: ${JSON.stringify(params)}` }] };
    }
  );

  // ── Get Effects ─────────────────────────────────────────
  server.tool(
    'get_effects',
    'Get all effects processors and their current settings.',
    {},
    async () => {
      const driver = getDriver();
      const effects = await driver.getAllEffects();
      return { content: [{ type: 'text' as const, text: JSON.stringify(effects, null, 2) }] };
    }
  );

  // ── Set Effect ──────────────────────────────────────────
  server.tool(
    'set_effect',
    'Configure an effects processor slot (reverb, delay, chorus, etc.).',
    {
      slot: z.number().int().min(1).max(8).describe('Effects slot number (1-8)'),
      type: z.string().optional().describe('Effect type (reverb-hall, reverb-plate, delay-mono, etc.)'),
      parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).optional().describe('Effect parameters as key-value pairs'),
    },
    async ({ slot, type, parameters }: { slot: number; type?: string; parameters?: Record<string, number | string | boolean> }) => {
      const driver = getDriver();
      await driver.setEffect(slot, { type, parameters } as any);
      return { content: [{ type: 'text' as const, text: `Updated FX slot ${slot}${type ? `: ${type}` : ''}` }] };
    }
  );

  // ── DCA Group Control ───────────────────────────────────
  server.tool(
    'set_dca',
    'Control a DCA/VCA group fader. DCA groups control multiple channels at once.',
    {
      dca: z.number().int().min(1).max(8).describe('DCA group number (1-8)'),
      level_db: z.number().min(-90).max(10).optional().describe('DCA fader level in dB'),
      muted: z.boolean().optional().describe('Mute the DCA group'),
    },
    async ({ dca, level_db, muted }: { dca: number; level_db?: number; muted?: boolean }) => {
      const driver = getDriver();
      await driver.setDCA(dca, { level_db: level_db ?? 0, muted: muted ?? false });
      return { content: [{ type: 'text' as const, text: `Set DCA ${dca}: ${level_db !== undefined ? `${level_db}dB` : ''} ${muted !== undefined ? (muted ? 'muted' : 'unmuted') : ''}` }] };
    }
  );

  // ── Scene Recall ────────────────────────────────────────
  server.tool(
    'recall_scene',
    'Recall a saved scene/snapshot on the console. WARNING: This will change all console settings.',
    {
      scene: z.number().int().min(0).max(99).describe('Scene number to recall (0-99)'),
    },
    async ({ scene }: { scene: number }) => {
      const driver = getDriver();
      await driver.recallScene(scene);
      return { content: [{ type: 'text' as const, text: `Recalled scene ${scene}` }] };
    }
  );

  // ── List Scenes ─────────────────────────────────────────
  server.tool(
    'list_scenes',
    'List all saved scenes/snapshots on the console.',
    {},
    async () => {
      const driver = getDriver();
      const scenes = await driver.getSceneList();
      return { content: [{ type: 'text' as const, text: JSON.stringify(scenes, null, 2) }] };
    }
  );

  // ── Mute Group ──────────────────────────────────────────
  server.tool(
    'set_mute_group',
    'Activate or deactivate a mute group.',
    {
      group: z.number().int().min(1).max(6).describe('Mute group number'),
      active: z.boolean().describe('true = mute group active (channels muted)'),
    },
    async ({ group, active }: { group: number; active: boolean }) => {
      const driver = getDriver();
      await driver.setMuteGroup(group, active);
      return { content: [{ type: 'text' as const, text: `Mute group ${group}: ${active ? 'ACTIVE' : 'inactive'}` }] };
    }
  );
}

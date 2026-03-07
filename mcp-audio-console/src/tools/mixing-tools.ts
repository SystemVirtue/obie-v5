/**
 * MCP tools for high-level mixing operations and professional knowledge.
 * These tools encode FOH engineering expertise and enable AI-assisted mixing.
 */

import { z } from 'zod';
import type { ConsoleDriver } from '../console/interface.js';
import type { ChannelType } from '../console/types.js';
import {
  EQ_PRESETS,
  DYNAMICS_PRESETS,
  EFFECT_PRESETS,
  MIXING_GUIDELINES,
  CHANNEL_LAYOUTS,
} from '../mixing/knowledge.js';

export function registerMixingTools(server: any, getDriver: () => ConsoleDriver) {
  // ── Get Console Info ────────────────────────────────────
  server.tool(
    'get_console_info',
    'Get the connected console model, capabilities, and connection status.',
    {},
    async () => {
      const driver = getDriver();
      const caps = driver.getCapabilities();
      const status = driver.getStatus();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ status, capabilities: caps }, null, 2),
        }],
      };
    }
  );

  // ── Get Mixing Guidelines ───────────────────────────────
  server.tool(
    'get_mixing_guidelines',
    'Get professional FOH mixing guidelines and best practices. Topics: gain_staging, eq_philosophy, dynamics_philosophy, mix_structure, live_show_tips, frequency_ranges, common_problems.',
    {
      topic: z.enum([
        'gain_staging', 'eq_philosophy', 'dynamics_philosophy',
        'mix_structure', 'live_show_tips', 'frequency_ranges',
        'common_problems', 'all',
      ]).describe('Which topic to retrieve'),
    },
    async ({ topic }: { topic: string }) => {
      if (topic === 'all') {
        return { content: [{ type: 'text' as const, text: JSON.stringify(MIXING_GUIDELINES, null, 2) }] };
      }
      const data = MIXING_GUIDELINES[topic as keyof typeof MIXING_GUIDELINES];
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── List Available Presets ──────────────────────────────
  server.tool(
    'list_presets',
    'List all available professional presets for EQ, dynamics, effects, and channel layouts.',
    {
      category: z.enum(['eq', 'dynamics', 'effects', 'layouts', 'all']).describe('Preset category'),
    },
    async ({ category }: { category: string }) => {
      const result: Record<string, unknown> = {};
      if (category === 'eq' || category === 'all') {
        result.eq = Object.entries(EQ_PRESETS).map(([key, p]) => ({ key, name: p.name, description: p.description }));
      }
      if (category === 'dynamics' || category === 'all') {
        result.dynamics = Object.entries(DYNAMICS_PRESETS).map(([key, p]) => ({ key, name: p.name, description: p.description }));
      }
      if (category === 'effects' || category === 'all') {
        result.effects = Object.entries(EFFECT_PRESETS).map(([key, p]) => ({ key, name: p.name, description: p.description }));
      }
      if (category === 'layouts' || category === 'all') {
        result.layouts = Object.entries(CHANNEL_LAYOUTS).map(([key, l]) => ({ key, name: l.name, description: l.description }));
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── Apply Channel Layout ────────────────────────────────
  server.tool(
    'apply_channel_layout',
    'Apply a full channel layout template with names, EQ, dynamics, and effects. This sets up the entire console for a specific type of show. Available: rock-band-basic, worship-band.',
    {
      layout: z.string().describe('Layout template name'),
    },
    async ({ layout }: { layout: string }) => {
      const template = CHANNEL_LAYOUTS[layout];
      if (!template) {
        return {
          content: [{ type: 'text' as const, text: `Unknown layout "${layout}". Available: ${Object.keys(CHANNEL_LAYOUTS).join(', ')}` }],
          isError: true,
        };
      }

      const driver = getDriver();
      const results: string[] = [`Applying layout: ${template.name}`];

      // Set channel names and apply presets
      for (const ch of template.channels) {
        await driver.setChannelConfig('input', ch.index, { name: ch.name });
        results.push(`Ch ${ch.index}: "${ch.name}"`);

        if (ch.phantom !== undefined) {
          await driver.setPreamp(ch.index, { phantom: ch.phantom });
        }
        if (ch.highpass) {
          await driver.setPreamp(ch.index, { low_cut: true, low_cut_freq: ch.highpass });
        }

        // Apply EQ preset
        if (ch.eq_preset && EQ_PRESETS[ch.eq_preset]) {
          const eq = EQ_PRESETS[ch.eq_preset];
          if (eq.highpass) {
            await driver.setPreamp(ch.index, { low_cut: true, low_cut_freq: eq.highpass });
          }
          await driver.setEQEnabled('input', ch.index, true);
          for (let i = 0; i < eq.bands.length; i++) {
            await driver.setEQBand('input', ch.index, i + 1, {
              frequency: eq.bands[i].freq,
              gain: eq.bands[i].gain,
              q: eq.bands[i].q,
            });
          }
        }

        // Apply dynamics preset
        if (ch.dynamics_preset && DYNAMICS_PRESETS[ch.dynamics_preset]) {
          const dyn = DYNAMICS_PRESETS[ch.dynamics_preset];
          if (dyn.gate) {
            await driver.setGate('input', ch.index, { enabled: true, ...dyn.gate });
          }
          await driver.setCompressor('input', ch.index, { enabled: true, ...dyn.compressor });
        }
      }

      // Set DCA names
      for (const dca of template.dca_groups) {
        await driver.setChannelConfig('dca', dca.index, { name: dca.name });
        results.push(`DCA ${dca.index}: "${dca.name}"`);
      }

      results.push(`\nLayout "${template.name}" applied to ${template.channels.length} channels, ${template.dca_groups.length} DCAs, ${template.fx_sends.length} FX sends.`);
      return { content: [{ type: 'text' as const, text: results.join('\n') }] };
    }
  );

  // ── Diagnose Mix Problem ────────────────────────────────
  server.tool(
    'diagnose_mix_problem',
    'Get professional advice for common live sound problems. Available problems: feedback, muddy_mix, harsh_mix, thin_mix, vocal_buried, no_punch, phase_issues.',
    {
      problem: z.enum([
        'feedback', 'muddy_mix', 'harsh_mix', 'thin_mix',
        'vocal_buried', 'no_punch', 'phase_issues',
      ]).describe('The mix problem to diagnose'),
    },
    async ({ problem }: { problem: string }) => {
      const advice = MIXING_GUIDELINES.common_problems[problem as keyof typeof MIXING_GUIDELINES.common_problems];
      return { content: [{ type: 'text' as const, text: `Problem: ${problem}\n\nAdvice: ${advice}` }] };
    }
  );

  // ── Get Mix Overview ────────────────────────────────────
  server.tool(
    'get_mix_overview',
    'Get a high-level overview of the entire mix — all channel levels, mutes, and routing. Useful for understanding the current mix state before making changes.',
    {},
    async () => {
      const driver = getDriver();
      const caps = driver.getCapabilities();

      const sections: string[] = ['=== MIX OVERVIEW ===\n'];

      // Input channels
      const inputs = await driver.getAllChannelStates('input');
      sections.push('INPUT CHANNELS:');
      for (const ch of inputs) {
        const status = ch.fader.muted ? '[MUTED]' : `${ch.fader.level_db.toFixed(1)}dB`;
        sections.push(`  ${ch.config.index}. ${ch.config.name.padEnd(12)} ${status.padEnd(12)} Pan:${ch.pan.position}`);
      }

      // Buses
      sections.push('\nMIX BUSES:');
      const buses = await driver.getAllChannelStates('bus');
      for (const bus of buses) {
        const status = bus.fader.muted ? '[MUTED]' : `${bus.fader.level_db.toFixed(1)}dB`;
        sections.push(`  Bus ${bus.config.index}: ${bus.config.name.padEnd(12)} ${status}`);
      }

      // DCAs
      sections.push('\nDCA GROUPS:');
      for (let i = 1; i <= caps.dcas; i++) {
        const dca = await driver.getDCA(i);
        const status = dca.fader.muted ? '[MUTED]' : `${dca.fader.level_db.toFixed(1)}dB`;
        sections.push(`  DCA ${i}: ${dca.name.padEnd(12)} ${status}`);
      }

      // Main
      const mainFader = await driver.getFader('main', 1);
      sections.push(`\nMAIN LR: ${mainFader.muted ? '[MUTED]' : `${mainFader.level_db.toFixed(1)}dB`}`);

      return { content: [{ type: 'text' as const, text: sections.join('\n') }] };
    }
  );

  // ── Get Meters ──────────────────────────────────────────
  server.tool(
    'get_meters',
    'Get current meter readings (levels) for channels. Useful for checking signal presence and levels.',
    {
      channel_type: z.enum(['input', 'bus', 'main']).describe('Type of channels to meter'),
    },
    async ({ channel_type }: { channel_type: ChannelType }) => {
      const driver = getDriver();
      const meters = await driver.getMeters(channel_type);
      const formatted = meters.map(m =>
        `${m.channel_type} ${m.channel_index}: RMS ${m.rms_db.toFixed(1)}dB  Peak ${m.peak_db.toFixed(1)}dB`
      );
      return { content: [{ type: 'text' as const, text: formatted.join('\n') }] };
    }
  );
}

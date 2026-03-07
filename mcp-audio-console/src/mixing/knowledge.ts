/**
 * Professional FOH mixing knowledge base.
 * Encodes the experience and best practices of seasoned live sound engineers.
 * Used as context/resources for AI-assisted mixing decisions.
 */

// ── Instrument EQ Starting Points ──────────────────────────────

export interface EQPreset {
  name: string;
  description: string;
  highpass?: number;        // HPF frequency in Hz
  bands: {
    freq: number;
    gain: number;
    q: number;
    note: string;
  }[];
}

export const EQ_PRESETS: Record<string, EQPreset> = {
  // ── Vocals ───────────────────────────────────────────────
  'vocal-male': {
    name: 'Male Vocal',
    description: 'Starting point for male lead vocal. Cut mud around 200-300Hz, presence boost 3-5kHz.',
    highpass: 100,
    bands: [
      { freq: 250, gain: -3, q: 2, note: 'Cut mud/boominess' },
      { freq: 800, gain: -2, q: 3, note: 'Reduce honk/nasal if needed' },
      { freq: 3500, gain: 2, q: 1.5, note: 'Add presence/intelligibility' },
      { freq: 10000, gain: 1.5, q: 0.7, note: 'Air/shimmer (shelf)' },
    ],
  },
  'vocal-female': {
    name: 'Female Vocal',
    description: 'Starting point for female lead vocal. Higher HPF, gentle presence boost.',
    highpass: 120,
    bands: [
      { freq: 200, gain: -2, q: 2, note: 'Cut mud' },
      { freq: 600, gain: -2, q: 3, note: 'Reduce boxiness' },
      { freq: 4000, gain: 2, q: 1.5, note: 'Presence/clarity' },
      { freq: 12000, gain: 2, q: 0.7, note: 'Air/breathiness (shelf)' },
    ],
  },

  // ── Drums ────────────────────────────────────────────────
  'kick-drum': {
    name: 'Kick Drum',
    description: 'Punchy kick with attack and sub weight. Scoop the mud.',
    highpass: 30,
    bands: [
      { freq: 60, gain: 3, q: 1.5, note: 'Sub weight/thump' },
      { freq: 350, gain: -4, q: 2, note: 'Cut mud/cardboard' },
      { freq: 3000, gain: 3, q: 2, note: 'Beater attack/click' },
      { freq: 8000, gain: -2, q: 1, note: 'Reduce bleed/harshness' },
    ],
  },
  'snare-drum': {
    name: 'Snare Drum',
    description: 'Crack and body. Cut ring if needed, boost attack.',
    highpass: 80,
    bands: [
      { freq: 200, gain: 2, q: 2, note: 'Body/fatness' },
      { freq: 500, gain: -3, q: 4, note: 'Cut ring/boxy tone' },
      { freq: 2500, gain: 3, q: 2, note: 'Crack/attack' },
      { freq: 10000, gain: 2, q: 1, note: 'Snare wire sizzle' },
    ],
  },
  'hi-hat': {
    name: 'Hi-Hat',
    description: 'Clean hi-hat with minimal bleed.',
    highpass: 300,
    bands: [
      { freq: 500, gain: -4, q: 2, note: 'Cut snare bleed' },
      { freq: 1000, gain: -2, q: 2, note: 'Reduce clang' },
      { freq: 6000, gain: 2, q: 1.5, note: 'Stick definition' },
      { freq: 12000, gain: 1, q: 0.7, note: 'Shimmer' },
    ],
  },
  'toms': {
    name: 'Toms',
    description: 'Full toms with attack and minimal ring.',
    highpass: 60,
    bands: [
      { freq: 100, gain: 3, q: 1.5, note: 'Low-end weight' },
      { freq: 400, gain: -4, q: 3, note: 'Cut boxy/ring' },
      { freq: 3000, gain: 3, q: 2, note: 'Stick attack' },
      { freq: 8000, gain: -2, q: 1, note: 'Reduce cymbal bleed' },
    ],
  },
  'overheads': {
    name: 'Drum Overheads',
    description: 'Cymbals and kit image. HPF aggressively to keep out of the kick range.',
    highpass: 200,
    bands: [
      { freq: 400, gain: -2, q: 2, note: 'Clean up low-mid buildup' },
      { freq: 2000, gain: -1, q: 2, note: 'Reduce harshness' },
      { freq: 8000, gain: 2, q: 1, note: 'Cymbal shimmer' },
      { freq: 14000, gain: 1, q: 0.7, note: 'Air' },
    ],
  },

  // ── Bass ─────────────────────────────────────────────────
  'bass-guitar-di': {
    name: 'Bass Guitar (DI)',
    description: 'Clean DI bass. Add warmth and definition.',
    highpass: 30,
    bands: [
      { freq: 80, gain: 2, q: 1.5, note: 'Sub foundation' },
      { freq: 250, gain: -3, q: 2, note: 'Cut boom/mud' },
      { freq: 700, gain: 2, q: 2, note: 'Growl/note definition' },
      { freq: 2500, gain: 2, q: 1.5, note: 'String attack/pluck' },
    ],
  },
  'bass-guitar-amp': {
    name: 'Bass Guitar (Amp)',
    description: 'Mic\'d bass amp. Control low-end and add bite.',
    highpass: 40,
    bands: [
      { freq: 80, gain: 2, q: 1.5, note: 'Low-end weight' },
      { freq: 300, gain: -3, q: 2, note: 'Cut mud from cabinet' },
      { freq: 800, gain: 1, q: 2, note: 'Midrange growl' },
      { freq: 3000, gain: 2, q: 2, note: 'Pick/finger attack' },
    ],
  },

  // ── Guitars ──────────────────────────────────────────────
  'electric-guitar-clean': {
    name: 'Electric Guitar (Clean)',
    description: 'Clean electric guitar. Sparkle and presence.',
    highpass: 100,
    bands: [
      { freq: 200, gain: -2, q: 2, note: 'Cut low-end bloom' },
      { freq: 800, gain: -2, q: 3, note: 'Reduce honk' },
      { freq: 3000, gain: 2, q: 1.5, note: 'Presence/cut' },
      { freq: 8000, gain: 2, q: 1, note: 'Sparkle/chime' },
    ],
  },
  'electric-guitar-distorted': {
    name: 'Electric Guitar (Distorted)',
    description: 'Distorted guitar. Tame fizz, add chunk, cut competing frequencies.',
    highpass: 80,
    bands: [
      { freq: 150, gain: -2, q: 2, note: 'Cut low-end mud (keep out of bass range)' },
      { freq: 500, gain: 1, q: 2, note: 'Chunk/palm mute body' },
      { freq: 3000, gain: -2, q: 3, note: 'Tame upper-mid harshness' },
      { freq: 6000, gain: -3, q: 2, note: 'Cut fizz/buzz' },
    ],
  },
  'acoustic-guitar': {
    name: 'Acoustic Guitar',
    description: 'Acoustic guitar. Combat boominess, add sparkle.',
    highpass: 80,
    bands: [
      { freq: 200, gain: -3, q: 2, note: 'Cut boominess (especially with body mic)' },
      { freq: 800, gain: -2, q: 3, note: 'Reduce boxiness' },
      { freq: 3000, gain: 2, q: 1.5, note: 'Strumming definition' },
      { freq: 10000, gain: 2, q: 0.7, note: 'String sparkle (shelf)' },
    ],
  },

  // ── Keys ─────────────────────────────────────────────────
  'piano': {
    name: 'Piano / Keys',
    description: 'Piano or keyboard. Full range, control mud, add clarity.',
    highpass: 40,
    bands: [
      { freq: 300, gain: -2, q: 2, note: 'Cut mud buildup' },
      { freq: 1000, gain: -1, q: 2, note: 'Reduce honk' },
      { freq: 3500, gain: 2, q: 1.5, note: 'Hammer attack/presence' },
      { freq: 10000, gain: 1, q: 0.7, note: 'Air and brilliance' },
    ],
  },

  // ── Horns/Brass ──────────────────────────────────────────
  'trumpet': {
    name: 'Trumpet',
    description: 'Trumpet. Control harshness, add warmth.',
    highpass: 150,
    bands: [
      { freq: 300, gain: 1, q: 2, note: 'Warmth/body' },
      { freq: 1000, gain: -2, q: 3, note: 'Reduce nasal honk' },
      { freq: 3000, gain: -2, q: 2, note: 'Tame bite/harshness' },
      { freq: 8000, gain: 1, q: 1, note: 'Brilliance' },
    ],
  },
  'saxophone': {
    name: 'Saxophone',
    description: 'Saxophone. Smooth harshness, add body.',
    highpass: 100,
    bands: [
      { freq: 250, gain: 1, q: 2, note: 'Body/warmth' },
      { freq: 800, gain: -2, q: 3, note: 'Reduce honk' },
      { freq: 3000, gain: -2, q: 2, note: 'Tame bite' },
      { freq: 6000, gain: 1, q: 1.5, note: 'Breathiness/detail' },
    ],
  },
};

// ── Dynamics Starting Points ───────────────────────────────────

export interface DynamicsPreset {
  name: string;
  description: string;
  gate?: {
    threshold: number;
    range: number;
    attack: number;
    hold: number;
    release: number;
  };
  compressor: {
    threshold: number;
    ratio: number;
    attack: number;
    hold: number;
    release: number;
    knee: number;
    makeup_gain: number;
  };
}

export const DYNAMICS_PRESETS: Record<string, DynamicsPreset> = {
  'vocal-gentle': {
    name: 'Vocal (Gentle)',
    description: 'Gentle vocal compression for consistent level. 2-3dB gain reduction.',
    compressor: { threshold: -20, ratio: 2.5, attack: 10, hold: 0, release: 100, knee: 3, makeup_gain: 2 },
  },
  'vocal-aggressive': {
    name: 'Vocal (Aggressive)',
    description: 'Heavier vocal compression for loud stages. 6-8dB gain reduction.',
    compressor: { threshold: -25, ratio: 4, attack: 5, hold: 0, release: 80, knee: 2, makeup_gain: 5 },
  },
  'kick-gate': {
    name: 'Kick Drum Gate + Comp',
    description: 'Gate to clean up kick bleed, light compression for punch.',
    gate: { threshold: -30, range: 40, attack: 0.5, hold: 50, release: 100 },
    compressor: { threshold: -15, ratio: 3, attack: 10, hold: 0, release: 80, knee: 2, makeup_gain: 3 },
  },
  'snare-gate': {
    name: 'Snare Gate + Comp',
    description: 'Gate for clean snare, compression for consistency.',
    gate: { threshold: -25, range: 30, attack: 0.5, hold: 30, release: 80 },
    compressor: { threshold: -18, ratio: 3, attack: 5, hold: 0, release: 60, knee: 2, makeup_gain: 3 },
  },
  'tom-gate': {
    name: 'Tom Gate',
    description: 'Gate to eliminate tom bleed when not being played.',
    gate: { threshold: -28, range: 40, attack: 1, hold: 80, release: 150 },
    compressor: { threshold: -15, ratio: 2, attack: 15, hold: 0, release: 100, knee: 3, makeup_gain: 2 },
  },
  'bass-comp': {
    name: 'Bass Guitar Compression',
    description: 'Even out bass dynamics for a solid foundation.',
    compressor: { threshold: -20, ratio: 4, attack: 15, hold: 0, release: 120, knee: 2, makeup_gain: 4 },
  },
  'acoustic-guitar-comp': {
    name: 'Acoustic Guitar Compression',
    description: 'Light compression for consistent strumming level.',
    compressor: { threshold: -18, ratio: 2.5, attack: 20, hold: 0, release: 150, knee: 3, makeup_gain: 2 },
  },
  'bus-glue': {
    name: 'Bus Glue Compression',
    description: 'Gentle bus compression to glue a submix together. 1-2dB GR.',
    compressor: { threshold: -15, ratio: 2, attack: 30, hold: 0, release: 200, knee: 4, makeup_gain: 1 },
  },
};

// ── Effects Starting Points ────────────────────────────────────

export interface EffectPreset {
  name: string;
  description: string;
  type: string;
  parameters: Record<string, number>;
}

export const EFFECT_PRESETS: Record<string, EffectPreset> = {
  'vocal-plate': {
    name: 'Vocal Plate Reverb',
    description: 'Classic vocal plate reverb. Bright, smooth, doesn\'t muddy the mix.',
    type: 'reverb-plate',
    parameters: { decay: 1.8, predelay: 30, damping: 0.6, size: 0.7, diffusion: 0.8, lowcut: 300, highcut: 8000, mix: 0.25 },
  },
  'vocal-room': {
    name: 'Vocal Room Reverb',
    description: 'Natural room sound for vocals. Short and subtle.',
    type: 'reverb-room',
    parameters: { decay: 0.8, predelay: 10, damping: 0.5, size: 0.4, diffusion: 0.6, lowcut: 200, highcut: 6000, mix: 0.15 },
  },
  'snare-plate': {
    name: 'Snare Plate Reverb',
    description: 'Short bright plate for snare snap.',
    type: 'reverb-plate',
    parameters: { decay: 1.2, predelay: 5, damping: 0.7, size: 0.5, diffusion: 0.7, lowcut: 400, highcut: 7000, mix: 0.2 },
  },
  'vocal-delay': {
    name: 'Vocal Delay (1/4 note)',
    description: 'Quarter-note vocal delay. Tempo-synced if possible.',
    type: 'delay-mono',
    parameters: { time: 375, feedback: 0.25, lowcut: 300, highcut: 5000, mix: 0.2 },
  },
  'vocal-slap': {
    name: 'Vocal Slap Delay',
    description: 'Short slapback delay for vocal thickening.',
    type: 'delay-mono',
    parameters: { time: 80, feedback: 0.1, lowcut: 200, highcut: 6000, mix: 0.15 },
  },
  'hall-reverb': {
    name: 'Hall Reverb',
    description: 'Large hall reverb for lush ambience. Use sparingly in live sound.',
    type: 'reverb-hall',
    parameters: { decay: 2.5, predelay: 40, damping: 0.5, size: 0.9, diffusion: 0.9, lowcut: 200, highcut: 6000, mix: 0.2 },
  },
};

// ── FOH Mixing Guidelines ──────────────────────────────────────

export const MIXING_GUIDELINES = {
  gain_staging: [
    'Set preamp gain so peaks hit around -18dBFS to -12dBFS on the channel meter.',
    'Leave headroom. Clipping the preamp is the worst distortion in the signal chain.',
    'Unity gain structure: each stage (preamp → channel → bus → main) should pass signal near 0dB nominal.',
    'If you need more level, reach for the fader — never the preamp — during the show.',
    'Set gains during soundcheck at performance volume, not whisper volume.',
  ],

  eq_philosophy: [
    'Cut before you boost. Subtractive EQ almost always sounds better than additive.',
    'High-pass everything that doesn\'t need low end. Guitars at 100Hz, vocals at 80-120Hz, overheads at 200Hz.',
    'If it sounds muddy, cut 200-400Hz before boosting highs.',
    'If it sounds harsh, cut 2-5kHz before cutting highs (you\'ll lose definition).',
    'Narrow cuts (high Q) for surgical problem removal. Wide boosts (low Q) for tonal shaping.',
    'Solo is for finding problems. Never mix in solo — always reference in context.',
    'Every EQ move should serve the mix, not the individual channel.',
  ],

  dynamics_philosophy: [
    'Gates: set threshold just above the bleed level. Too aggressive = choppy, unnatural.',
    'Gate attack should be fast for transients (drums), slower for sustain instruments.',
    'Compression: aim for 3-6dB of gain reduction on vocals. If you need more, the performer is too dynamic.',
    'Fast attack on compression kills transients — intentional on bass, destructive on drums.',
    'Slow release causes pumping. Set release so the compressor recovers before the next hit.',
    'Parallel compression (mix knob) preserves dynamics while adding density.',
    'Bus compression should be subtle (1-3dB GR). It\'s glue, not a clamp.',
  ],

  mix_structure: [
    'Build the mix from the bottom up: kick → bass → drums → guitars → keys → vocals.',
    'Or build from vocals down: lead vocal → drums → bass → everything else.',
    'Lead vocal should sit ON TOP of the mix, not buried in it.',
    'Pan drums from audience perspective (or drummer perspective — pick one and be consistent).',
    'Create depth with reverb: dry = close, wet = far. Don\'t drown things in reverb.',
    'Use high-pass filters on reverb returns to keep low end clean.',
    'DCA groups for quick mix management: Drums, Bass, Guitars, Keys, Vocals, FX.',
    'Mute unused channels to reduce noise floor and bleed.',
  ],

  live_show_tips: [
    'Walk the room during soundcheck. The mix sounds different everywhere.',
    'Mix at conversation level — if you can\'t talk to someone 3 feet away, it\'s too loud.',
    'The first song is your real soundcheck. Make your moves then.',
    'Ride the vocal fader. This is the #1 job of a FOH engineer.',
    'Watch the performers. Anticipate when they\'ll get louder or softer.',
    'Less is more with effects. If you can hear the reverb, it\'s probably too much.',
    'If something sounds bad, mute it first to confirm it\'s actually that channel.',
    'Check your mix from the audience perspective regularly.',
    'Trust your ears, not your eyes. Meters confirm — they don\'t decide.',
    'When in doubt, pull it down. You can always add more.',
  ],

  frequency_ranges: {
    sub_bass: { range: '20-60 Hz', description: 'Felt more than heard. Kick drum sub, bass guitar fundamentals.' },
    bass: { range: '60-250 Hz', description: 'Warmth and body. Kick punch, bass guitar, low vocals.' },
    low_mids: { range: '250-500 Hz', description: 'Mud/boxy zone. Cut here on most sources to clean up the mix.' },
    mids: { range: '500-2000 Hz', description: 'Body of most instruments. Honky/nasal if too much.' },
    upper_mids: { range: '2-5 kHz', description: 'Presence and intelligibility. Vocal clarity lives here.' },
    highs: { range: '5-10 kHz', description: 'Definition and brightness. Sibilance lives at 5-8kHz.' },
    air: { range: '10-20 kHz', description: 'Air and shimmer. Subtle. Roll off for warmth.' },
  },

  common_problems: {
    feedback: 'Identify the frequency (ring-out), cut with narrow EQ on that channel. Check monitor levels. Consider moving mic/speaker placement.',
    muddy_mix: 'HPF everything aggressively. Cut 200-400Hz on guitars and keys. Reduce reverb. Check for phase issues between mics.',
    harsh_mix: 'Cut 2-5kHz range. Check for distortion in preamps. Reduce overall level. Add warmth with subtle low-shelf boost.',
    thin_mix: 'Check HPF settings (too aggressive?). Add gentle low-mid boost on key instruments. Check phase correlation.',
    vocal_buried: 'Push vocal fader first. Then cut competing frequencies on guitars (3-5kHz) and keys. Reduce reverb on everything else.',
    no_punch: 'Check compressor attack times (too fast kills transients). Boost kick at 60Hz and 3kHz. Cut bass guitar at kick frequencies.',
    phase_issues: 'Flip polarity on one mic. Time-align close mics with overheads. Check DI vs amp phase on bass.',
  },
} as const;

// ── Channel Layout Templates ───────────────────────────────────

export interface ChannelLayoutTemplate {
  name: string;
  description: string;
  channels: {
    index: number;
    name: string;
    type: 'input';
    instrument: string;
    eq_preset?: string;
    dynamics_preset?: string;
    dca_group?: string;
    phantom?: boolean;
    highpass?: number;
  }[];
  dca_groups: { index: number; name: string }[];
  fx_sends: { slot: number; preset: string }[];
}

export const CHANNEL_LAYOUTS: Record<string, ChannelLayoutTemplate> = {
  'rock-band-basic': {
    name: 'Rock Band (Basic)',
    description: '4-piece rock band: drums, bass, guitar, vocals.',
    channels: [
      { index: 1, name: 'Kick', type: 'input', instrument: 'kick-drum', eq_preset: 'kick-drum', dynamics_preset: 'kick-gate', dca_group: 'Drums' },
      { index: 2, name: 'Snare', type: 'input', instrument: 'snare-drum', eq_preset: 'snare-drum', dynamics_preset: 'snare-gate', dca_group: 'Drums' },
      { index: 3, name: 'Hi-Hat', type: 'input', instrument: 'hi-hat', eq_preset: 'hi-hat', dca_group: 'Drums' },
      { index: 4, name: 'Tom 1', type: 'input', instrument: 'toms', eq_preset: 'toms', dynamics_preset: 'tom-gate', dca_group: 'Drums' },
      { index: 5, name: 'Tom 2', type: 'input', instrument: 'toms', eq_preset: 'toms', dynamics_preset: 'tom-gate', dca_group: 'Drums' },
      { index: 6, name: 'OH L', type: 'input', instrument: 'overheads', eq_preset: 'overheads', dca_group: 'Drums', phantom: true },
      { index: 7, name: 'OH R', type: 'input', instrument: 'overheads', eq_preset: 'overheads', dca_group: 'Drums', phantom: true },
      { index: 8, name: 'Bass DI', type: 'input', instrument: 'bass-guitar-di', eq_preset: 'bass-guitar-di', dynamics_preset: 'bass-comp', dca_group: 'Bass' },
      { index: 9, name: 'Gtr L', type: 'input', instrument: 'electric-guitar-distorted', eq_preset: 'electric-guitar-distorted', dca_group: 'Guitars' },
      { index: 10, name: 'Gtr R', type: 'input', instrument: 'electric-guitar-clean', eq_preset: 'electric-guitar-clean', dca_group: 'Guitars' },
      { index: 11, name: 'Lead Vox', type: 'input', instrument: 'vocal-male', eq_preset: 'vocal-male', dynamics_preset: 'vocal-gentle', dca_group: 'Vocals', phantom: false },
      { index: 12, name: 'BV 1', type: 'input', instrument: 'vocal-female', eq_preset: 'vocal-female', dynamics_preset: 'vocal-gentle', dca_group: 'Vocals' },
      { index: 13, name: 'BV 2', type: 'input', instrument: 'vocal-male', eq_preset: 'vocal-male', dynamics_preset: 'vocal-gentle', dca_group: 'Vocals' },
    ],
    dca_groups: [
      { index: 1, name: 'Drums' },
      { index: 2, name: 'Bass' },
      { index: 3, name: 'Guitars' },
      { index: 4, name: 'Vocals' },
      { index: 5, name: 'FX' },
    ],
    fx_sends: [
      { slot: 1, preset: 'vocal-plate' },
      { slot: 2, preset: 'vocal-delay' },
      { slot: 3, preset: 'snare-plate' },
      { slot: 4, preset: 'hall-reverb' },
    ],
  },

  'worship-band': {
    name: 'Worship / Contemporary',
    description: 'Modern worship band: drums, bass, electric, acoustic, keys, vocals.',
    channels: [
      { index: 1, name: 'Kick', type: 'input', instrument: 'kick-drum', eq_preset: 'kick-drum', dynamics_preset: 'kick-gate', dca_group: 'Drums' },
      { index: 2, name: 'Snare T', type: 'input', instrument: 'snare-drum', eq_preset: 'snare-drum', dynamics_preset: 'snare-gate', dca_group: 'Drums' },
      { index: 3, name: 'Snare B', type: 'input', instrument: 'snare-drum', dca_group: 'Drums', phantom: true },
      { index: 4, name: 'Hi-Hat', type: 'input', instrument: 'hi-hat', eq_preset: 'hi-hat', dca_group: 'Drums' },
      { index: 5, name: 'Tom 1', type: 'input', instrument: 'toms', eq_preset: 'toms', dynamics_preset: 'tom-gate', dca_group: 'Drums' },
      { index: 6, name: 'Tom 2', type: 'input', instrument: 'toms', eq_preset: 'toms', dynamics_preset: 'tom-gate', dca_group: 'Drums' },
      { index: 7, name: 'OH L', type: 'input', instrument: 'overheads', eq_preset: 'overheads', dca_group: 'Drums', phantom: true },
      { index: 8, name: 'OH R', type: 'input', instrument: 'overheads', eq_preset: 'overheads', dca_group: 'Drums', phantom: true },
      { index: 9, name: 'Bass DI', type: 'input', instrument: 'bass-guitar-di', eq_preset: 'bass-guitar-di', dynamics_preset: 'bass-comp', dca_group: 'Bass' },
      { index: 10, name: 'E.Gtr 1', type: 'input', instrument: 'electric-guitar-clean', eq_preset: 'electric-guitar-clean', dca_group: 'Guitars' },
      { index: 11, name: 'E.Gtr 2', type: 'input', instrument: 'electric-guitar-clean', eq_preset: 'electric-guitar-clean', dca_group: 'Guitars' },
      { index: 12, name: 'Acous', type: 'input', instrument: 'acoustic-guitar', eq_preset: 'acoustic-guitar', dynamics_preset: 'acoustic-guitar-comp', dca_group: 'Guitars' },
      { index: 13, name: 'Keys L', type: 'input', instrument: 'piano', eq_preset: 'piano', dca_group: 'Keys' },
      { index: 14, name: 'Keys R', type: 'input', instrument: 'piano', eq_preset: 'piano', dca_group: 'Keys' },
      { index: 15, name: 'Pads L', type: 'input', instrument: 'piano', dca_group: 'Keys' },
      { index: 16, name: 'Pads R', type: 'input', instrument: 'piano', dca_group: 'Keys' },
      { index: 17, name: 'Lead Vox', type: 'input', instrument: 'vocal-male', eq_preset: 'vocal-male', dynamics_preset: 'vocal-gentle', dca_group: 'Vocals' },
      { index: 18, name: 'Vox 2', type: 'input', instrument: 'vocal-female', eq_preset: 'vocal-female', dynamics_preset: 'vocal-gentle', dca_group: 'Vocals' },
      { index: 19, name: 'Vox 3', type: 'input', instrument: 'vocal-male', eq_preset: 'vocal-male', dynamics_preset: 'vocal-gentle', dca_group: 'Vocals' },
      { index: 20, name: 'Vox 4', type: 'input', instrument: 'vocal-female', eq_preset: 'vocal-female', dynamics_preset: 'vocal-gentle', dca_group: 'Vocals' },
    ],
    dca_groups: [
      { index: 1, name: 'Drums' },
      { index: 2, name: 'Bass' },
      { index: 3, name: 'Guitars' },
      { index: 4, name: 'Keys' },
      { index: 5, name: 'Vocals' },
      { index: 6, name: 'FX' },
      { index: 7, name: 'Band' },
      { index: 8, name: 'All' },
    ],
    fx_sends: [
      { slot: 1, preset: 'vocal-plate' },
      { slot: 2, preset: 'vocal-delay' },
      { slot: 3, preset: 'snare-plate' },
      { slot: 4, preset: 'hall-reverb' },
    ],
  },
};

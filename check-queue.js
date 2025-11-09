import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function checkQueue() {
  try {
    console.log('Checking current queue state...');

    // Get all unplayed queue items
    const { data: queueItems, error } = await supabase
      .from('queue')
      .select('id, type, position, requested_at')
      .eq('player_id', '00000000-0000-0000-0000-000000000001')
      .is('played_at', null)
      .order('position', { ascending: true });

    if (error) throw error;

    console.log(`Total unplayed items: ${queueItems.length}`);

    // Group by type
    const byType = queueItems.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});

    console.log('Items by type:', byType);

    // Show first few items
    console.log('First 5 items:');
    queueItems.slice(0, 5).forEach(item => {
      console.log(`  ${item.type} - position ${item.position} - requested ${item.requested_at}`);
    });

  } catch (err) {
    console.error('Failed to check queue:', err);
  }
}

checkQueue();
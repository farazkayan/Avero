const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.log('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  try {
    // Try calling with a proper array parameter
    const { data, error } = await supabase.rpc('get_space_mosaic_thumbnails', { p_space_ids: ['00000000-0000-0000-0000-000000000000'] });
    console.log('RPC call with UUID:', JSON.stringify({ data, error }, null, 2));
    
    // Try calling get_space_list_thumbnails for comparison
    const { data: data2, error: error2 } = await supabase.rpc('get_space_list_thumbnails', { p_space_ids: ['00000000-0000-0000-0000-000000000000'] });
    console.log('get_space_list_thumbnails:', JSON.stringify({ data: data2, error: error2 }, null, 2));
    
    // Try calling get_timeline_thumbnails for comparison
    const { data: data3, error: error3 } = await supabase.rpc('get_timeline_thumbnails', { p_memory_ids: ['00000000-0000-0000-0000-000000000000'] });
    console.log('get_timeline_thumbnails:', JSON.stringify({ data: data3, error: error3 }, null, 2));
    
  } catch (e) {
    console.log('Exception:', e.message);
  }
}

check();
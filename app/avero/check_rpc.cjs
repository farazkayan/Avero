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
    const { data, error } = await supabase.rpc('get_space_mosaic_thumbnails', { p_space_ids: [] });
    console.log('RPC call result:', JSON.stringify({ data, error }, null, 2));
  } catch (e) {
    console.log('Exception:', e.message);
  }
}

check();
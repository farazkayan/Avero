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
    // Try to query pg_proc directly via rpc
    const { data, error } = await supabase.rpc('get_space_mosaic_thumbnails', { p_space_ids: [] });
    console.log('RPC call result:', JSON.stringify({ data, error }, null, 2));
    
    // Try calling with a proper authenticated user - we need to sign in first
    // Let's check if the function exists by trying a raw SQL query via rpc
    // Actually, let's just check if the function exists in the database
    // by trying to call it with a service role key if we had one
    
  } catch (e) {
    console.log('Exception:', e.message);
  }
}

check();
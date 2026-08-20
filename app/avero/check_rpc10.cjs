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
    // Try to call a simple select to see if we can query anything
    const { data, error } = await supabase
      .from('spaces')
      .select('id')
      .limit(1);
    console.log('Spaces table select:', JSON.stringify({ data, error }, null, 2));
    
    // Try to call a simple RPC that should exist
    const { data: data2, error: error2 } = await supabase.rpc('get_invitation_by_token', { p_token: '00000000-0000-0000-0000-000000000000' });
    console.log('get_invitation_by_token:', JSON.stringify({ data: data2, error: error2 }, null, 2));
    
    // Try calling get_space_list_thumbnails with empty array
    const { data: data3, error: error3 } = await supabase.rpc('get_space_list_thumbnails', { p_space_ids: [] });
    console.log('get_space_list_thumbnails empty:', JSON.stringify({ data: data3, error: error3 }, null, 2));
    
  } catch (e) {
    console.log('Exception:', e.message);
  }
}

check();
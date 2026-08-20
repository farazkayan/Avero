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
    // Try to call the function with a proper UUID array format
    // Test with explicit casting
    const { data, error } = await supabase.rpc('get_space_mosaic_thumbnails', { 
      p_space_ids: ['00000000-0000-0000-0000-000000000000'] 
    });
    console.log('RPC call with UUID array:', JSON.stringify({ data, error }, null, 2));
    
    // Try with empty array
    const { data: data2, error: error2 } = await supabase.rpc('get_space_mosaic_thumbnails', { 
      p_space_ids: [] 
    });
    console.log('RPC call with empty array:', JSON.stringify({ data: data2, error: error2 }, null, 2));
    
    // Try with null
    const { data: data3, error: error3 } = await supabase.rpc('get_space_mosaic_thumbnails', { 
      p_space_ids: null 
    });
    console.log('RPC call with null:', JSON.stringify({ data: data3, error: error3 }, null, 2));
    
    // Try without parameter
    const { data: data4, error: error4 } = await supabase.rpc('get_space_mosaic_thumbnails', {});
    console.log('RPC call without param:', JSON.stringify({ data: data4, error: error4 }, null, 2));
    
  } catch (e) {
    console.log('Exception:', e.message);
  }
}

check();
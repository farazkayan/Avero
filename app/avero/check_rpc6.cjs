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
    // Try calling a simple built-in function to see if RPC works at all
    const { data, error } = await supabase.rpc('version');
    console.log('version():', JSON.stringify({ data, error }, null, 2));
    
    // Try calling now()
    const { data: data2, error: error2 } = await supabase.rpc('now');
    console.log('now():', JSON.stringify({ data: data2, error: error2 }, null, 2));
    
  } catch (e) {
    console.log('Exception:', e.message);
  }
}

check();
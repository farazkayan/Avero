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
    // First, sign in with a test user to get a JWT
    // We need to use the anon key to sign in
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: 'test@example.com',
      password: 'testpassword123'
    });
    
    if (signInError) {
      console.log('Sign in error (expected if user does not exist):', signInError.message);
    } else {
      console.log('Signed in successfully');
      
      // Now try calling the RPC with the authenticated client
      const { data, error } = await supabase.rpc('get_space_mosaic_thumbnails', { 
        p_space_ids: [] 
      });
      console.log('RPC call with auth:', JSON.stringify({ data, error }, null, 2));
    }
    
  } catch (e) {
    console.log('Exception:', e.message);
  }
}

check();
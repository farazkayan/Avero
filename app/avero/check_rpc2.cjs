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
    // Check if function exists in pg_proc
    const { data: funcData, error: funcError } = await supabase
      .from('pg_proc')
      .select('proname, proargtypes, proargnames')
      .eq('proname', 'get_space_mosaic_thumbnails');
    console.log('Function in pg_proc:', JSON.stringify({ data: funcData, error: funcError }, null, 2));
    
    // Check columns on media table
    const { data: colData, error: colError } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_name', 'media')
      .in('column_name', ['thumbnail_grid_path', 'thumbnail_path']);
    console.log('Media columns:', JSON.stringify({ data: colData, error: colError }, null, 2));
    
    // Check grants
    const { data: grantData, error: grantError } = await supabase
      .from('information_schema.routine_privileges')
      .select('grantee, privilege_type')
      .eq('routine_name', 'get_space_mosaic_thumbnails');
    console.log('Grants:', JSON.stringify({ data: grantData, error: grantError }, null, 2));
    
  } catch (e) {
    console.log('Exception:', e.message);
  }
}

check();
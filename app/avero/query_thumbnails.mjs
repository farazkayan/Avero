import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function queryThumbnails() {
  const { data, error } = await supabase
    .from('media')
    .select('id, thumbnail_grid_path, thumbnail_detail_path, thumbnail_path, created_at, type')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Query error:', error);
    return;
  }

  console.log('Latest 10 media rows:');
  console.table(data);
}

queryThumbnails();
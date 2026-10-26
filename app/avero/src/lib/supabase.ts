import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://lvsgaqykefkvsbnkglpg.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_DczL1u6A-Y2IFl4DuwOyMQ_4460gBS1";

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const isInvalidUrl = !rawUrl || rawUrl.includes("your-project") || rawUrl.includes("placeholder-project");
const isInvalidKey = !rawKey || rawKey.includes("your_") || rawKey.includes("placeholder");

const supabaseUrl: string = isInvalidUrl ? DEFAULT_SUPABASE_URL : rawUrl;
const supabasePublishableKey: string = isInvalidKey ? DEFAULT_SUPABASE_KEY : rawKey;

export const supabase = createClient(supabaseUrl, supabasePublishableKey);

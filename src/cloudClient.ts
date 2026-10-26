import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
const allowedOrigins = (import.meta.env.VITE_CLOUD_SYNC_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const currentOrigin = typeof window === 'undefined' ? '' : window.location.origin
const cloudOriginAllowed = allowedOrigins.includes(currentOrigin)

export const cloudConfigured = Boolean(url && anonKey && cloudOriginAllowed)
export const cloudSyncBlockedByOrigin = Boolean(url && anonKey && !cloudOriginAllowed)

export const cloudClient = cloudConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

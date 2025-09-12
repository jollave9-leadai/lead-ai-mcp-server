// Resource management utilities for leads caching and subscription
import type { Lead, LeadSummary } from '@/types'

// Cache management interface
interface CacheEntry {
  data: Record<string, unknown>
  timestamp: number
  ttl: number
  uri: string
}

// In-memory cache for resources (in production, consider Redis or similar)
const resourceCache = new Map<string, CacheEntry>()

/**
 * Cache configuration for different resource types
 */
export const CACHE_CONFIG = {
  LEADS_FULL: {
    ttl: 300, // 5 minutes
    auto_refresh: true
  },
  LEADS_SUMMARY: {
    ttl: 600, // 10 minutes
    auto_refresh: true
  },
  LEADS_STAGE: {
    ttl: 180, // 3 minutes
    auto_refresh: true
  }
} as const

/**
 * Checks if a cache entry is still valid
 */
export function isCacheValid(entry: CacheEntry): boolean {
  const now = Date.now()
  return (now - entry.timestamp) < (entry.ttl * 1000)
}

/**
 * Gets cached data if valid, otherwise returns null
 */
export function getCachedResource(uri: string): Record<string, unknown> | null {
  const entry = resourceCache.get(uri)
  
  if (!entry) {
    console.log(`🔍 Cache miss for: ${uri}`)
    return null
  }
  
  if (!isCacheValid(entry)) {
    console.log(`⏰ Cache expired for: ${uri}`)
    resourceCache.delete(uri)
    return null
  }
  
  console.log(`✅ Cache hit for: ${uri}`)
  return entry.data
}

/**
 * Sets cached data with TTL
 */
export function setCachedResource(uri: string, data: Record<string, unknown>, ttl: number): void {
  const entry: CacheEntry = {
    data,
    timestamp: Date.now(),
    ttl,
    uri
  }
  
  resourceCache.set(uri, entry)
  console.log(`💾 Cached resource: ${uri} (TTL: ${ttl}s)`)
}

/**
 * Invalidates cache for a specific client
 */
export function invalidateClientCache(clientId: number): void {
  const keysToDelete: string[] = []
  
  for (const [uri] of resourceCache) {
    if (uri.includes(`/client/${clientId}`)) {
      keysToDelete.push(uri)
    }
  }
  
  keysToDelete.forEach(key => {
    resourceCache.delete(key)
    console.log(`🗑️ Invalidated cache: ${key}`)
  })
  
  console.log(`🔄 Invalidated ${keysToDelete.length} cache entries for client ${clientId}`)
}

/**
 * Invalidates all cache entries
 */
export function invalidateAllCache(): void {
  const count = resourceCache.size
  resourceCache.clear()
  console.log(`🗑️ Cleared all cache entries (${count} items)`)
}

/**
 * Gets cache statistics
 */
export function getCacheStats(): {
  total_entries: number
  valid_entries: number
  expired_entries: number
  cache_size_mb: number
} {
  let validCount = 0
  let expiredCount = 0
  
  for (const [, entry] of resourceCache) {
    if (isCacheValid(entry)) {
      validCount++
    } else {
      expiredCount++
    }
  }
  
  // Rough estimate of cache size
  const cacheSize = JSON.stringify([...resourceCache.values()]).length / (1024 * 1024)
  
  return {
    total_entries: resourceCache.size,
    valid_entries: validCount,
    expired_entries: expiredCount,
    cache_size_mb: Math.round(cacheSize * 100) / 100
  }
}

/**
 * Cleans up expired cache entries
 */
export function cleanupExpiredCache(): number {
  const keysToDelete: string[] = []
  
  for (const [uri, entry] of resourceCache) {
    if (!isCacheValid(entry)) {
      keysToDelete.push(uri)
    }
  }
  
  keysToDelete.forEach(key => {
    resourceCache.delete(key)
  })
  
  if (keysToDelete.length > 0) {
    console.log(`🧹 Cleaned up ${keysToDelete.length} expired cache entries`)
  }
  
  return keysToDelete.length
}

/**
 * Resource subscription manager for automatic cache refresh
 */
export class ResourceSubscriptionManager {
  private subscriptions = new Map<string, NodeJS.Timeout>()
  
  /**
   * Subscribe to automatic resource refresh
   */
  subscribe(uri: string, refreshCallback: () => Promise<void>, intervalSeconds: number): void {
    // Clear existing subscription if any
    this.unsubscribe(uri)
    
    const interval = setInterval(async () => {
      try {
        console.log(`🔄 Auto-refreshing resource: ${uri}`)
        await refreshCallback()
      } catch (error) {
        console.error(`❌ Auto-refresh failed for ${uri}:`, error)
      }
    }, intervalSeconds * 1000)
    
    this.subscriptions.set(uri, interval)
    console.log(`📡 Subscribed to auto-refresh: ${uri} (every ${intervalSeconds}s)`)
  }
  
  /**
   * Unsubscribe from automatic refresh
   */
  unsubscribe(uri: string): void {
    const interval = this.subscriptions.get(uri)
    if (interval) {
      clearInterval(interval)
      this.subscriptions.delete(uri)
      console.log(`📡 Unsubscribed from auto-refresh: ${uri}`)
    }
  }
  
  /**
   * Unsubscribe all resources for a client
   */
  unsubscribeClient(clientId: number): void {
    const keysToRemove: string[] = []
    
    for (const [uri] of this.subscriptions) {
      if (uri.includes(`/client/${clientId}`)) {
        keysToRemove.push(uri)
      }
    }
    
    keysToRemove.forEach(uri => this.unsubscribe(uri))
    console.log(`📡 Unsubscribed ${keysToRemove.length} auto-refresh subscriptions for client ${clientId}`)
  }
  
  /**
   * Get active subscriptions
   */
  getActiveSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys())
  }
  
  /**
   * Cleanup all subscriptions
   */
  cleanup(): void {
    for (const [uri] of this.subscriptions) {
      this.unsubscribe(uri)
    }
    console.log(`📡 Cleaned up all resource subscriptions`)
  }
}

// Global subscription manager instance
export const subscriptionManager = new ResourceSubscriptionManager()

/**
 * Helper function to build resource URIs
 */
export const ResourceURI = {
  clientLeads: (clientId: number) => `leads://client/${clientId}`,
  clientSummary: (clientId: number) => `leads://client/${clientId}/summary`,
  clientStage: (clientId: number, stage: string) => `leads://client/${clientId}/stage/${encodeURIComponent(stage)}`
}

/**
 * Resource data structure interfaces
 */
export interface LeadsResourceData {
  client_id: number
  last_updated: string
  summary: LeadSummary
  recent_leads: Lead[]
  total_available: number
  cache_info: {
    cached_at: string
    ttl_seconds: number
    auto_refresh: boolean
  }
}

export interface SummaryResourceData {
  client_id: number
  last_updated: string
  summary: LeadSummary
  cache_info: {
    cached_at: string
    ttl_seconds: number
    auto_refresh: boolean
  }
}

export interface StageResourceData {
  client_id: number
  stage: string
  last_updated: string
  leads: Lead[]
  count: number
  cache_info: {
    cached_at: string
    ttl_seconds: number
    auto_refresh: boolean
  }
}

// Cleanup expired cache entries every 5 minutes
setInterval(() => {
  cleanupExpiredCache()
}, 5 * 60 * 1000)

// Log cache stats every 10 minutes in development
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    const stats = getCacheStats()
    console.log(`📊 Cache Stats:`, stats)
  }, 10 * 60 * 1000)
}
